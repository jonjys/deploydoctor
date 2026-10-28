import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { authorizationUrl, connectionSchema, flowSchema, githubManifest, matchesState, nonce, openConnection, openGitHub, pkceChallenge, sealGitHub, setupSchema } from "../src/lib/github-connect-crypto";
import { issueGrowthSession } from "../src/lib/growth-auth";

const secret = "fixture-github-key-never-use-in-production-123456789";
const app = { clientId: "Iv1.fixture", clientSecret: "fixture-client-secret-123456789", slug: "deploydoctor-test" };
test("GitHub credentials are encrypted, purpose-separated, customer-bound and expire", () => {
  const now=Date.now(), value={customerId:"cus_owner",token:"ghu_fixture123",login:"fixture",expiresAt:now+3600_000};
  const sealed=sealGitHub(value,"connection",secret);
  assert.doesNotMatch(sealed,/ghu_|cus_owner/);assert.equal(openConnection(sealed,"cus_owner",secret,now)?.token,value.token);
  assert.equal(openConnection(sealed,"cus_other",secret,now),null);
  assert.equal(openConnection(sealed,"cus_owner",secret,now+3600_000),null);
  assert.equal(openConnection(sealed,"cus_owner",secret+"changed",now),null);
  assert.equal(openGitHub(sealed,"oauth",secret,connectionSchema),null);
  assert.equal(openConnection(sealed.slice(0,-4)+"aaaa","cus_owner",secret,now),null);
  assert.equal(openConnection("a".repeat(4000),"cus_owner",secret,now),null);
});
test("OAuth uses PKCE and state without broad repo scope; manifest is read-only with no event subscriptions",()=>{
  const state=nonce(),verifier=nonce(),url=new URL(authorizationUrl(app,"https://fixture.test",state,verifier));
  assert.equal(url.origin,"https://github.com");assert.equal(url.searchParams.get("code_challenge"),pkceChallenge(verifier));assert.equal(url.searchParams.get("code_challenge_method"),"S256");assert.equal(url.searchParams.get("scope"),null);assert.ok(!url.toString().includes(app.clientSecret));
  assert.ok(matchesState(state,state));assert.equal(matchesState(null,state),false);assert.equal(matchesState("x",state),false);
  const manifest=githubManifest("https://fixture.test");assert.deepEqual(manifest.default_permissions,{contents:"read",metadata:"read"});assert.deepEqual(manifest.default_events,[]);assert.equal(manifest.hook_attributes.active,false);
});
test("GitHub app configuration table denies browser roles and preserves insert-only service access", async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;");
    await db.exec(readFileSync(new URL("../supabase/migrations/20261028222949_github_app_connection.sql",import.meta.url),"utf8"));
    await db.exec("set role anon;");await assert.rejects(()=>db.query("select * from github_app_settings"));
    await db.exec("reset role;set role authenticated;");await assert.rejects(()=>db.query("select * from github_app_settings"));
    await db.exec("reset role;set role service_role;");
    const ciphertext=sealGitHub(app,"app-config",secret);
    await db.query("insert into github_app_settings(id,ciphertext) values('primary',$1)",[ciphertext]);
    assert.equal((await db.query("select * from github_app_settings")).rows.length,1);
    await assert.rejects(()=>db.query("update github_app_settings set ciphertext='changed'"));
    await assert.rejects(()=>db.query("insert into github_app_settings(id,ciphertext) values('primary',$1)",[ciphertext]));
  }finally{await db.close();}
});
test("real GitHub handlers enforce paid owner binding, callback state, PKCE, token secrecy and disconnection",async()=>{
  const require=createRequire(import.meta.url),jar=new Map<string,string>();
  const options:Record<string,unknown>[]=[];
  require.cache[require.resolve("server-only")]={exports:{},loaded:true} as NodeModule;
  require.cache[require.resolve("next/headers")]={exports:{cookies:async()=>({get:(name:string)=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name:string,value:string,opts:Record<string,unknown>)=>{jar.set(name,value);options.push(opts);},delete:(name:string)=>jar.delete(name)})},loaded:true} as NodeModule;
  let paid=true;let customer={customerId:"cus_owner",email:"fixture@example.test",expiresAt:Date.now()+24*3600_000};
  require.cache[require.resolve("../src/lib/access")]={exports:{customerSession:async()=>customer,activePlan:async()=>paid?{plan:"week",current_period_end:new Date(Date.now()+24*3600_000).toISOString()}:null},loaded:true} as NodeModule;
  const real=require("../src/lib/github-connect");
  let configured=true;const saved:unknown[]=[];
  require.cache[require.resolve("../src/lib/github-connect")]!.exports={...real,githubApp:async()=>configured?app:null,saveGitHubApp:async(value:unknown)=>{saved.push(value);}};
  const previousSecret=process.env.SESSION_SECRET,previousEnv=process.env.VERCEL_ENV,previousFetch=globalThis.fetch,previousOwner=process.env.GROWTH_DASHBOARD_PASSWORD;
  process.env.SESSION_SECRET=secret;delete process.env.VERCEL_ENV;
  const {GET,POST}=await import("../src/app/api/github/[action]/route");
  const get=(action:string,query="")=>GET(new Request("https://fixture.test/api/github/"+action+query),{params:Promise.resolve({action})});
  const requests:string[]=[];let exchangedVerifier="";
  globalThis.fetch=async(url,init)=>{
    requests.push(String(url));assert.equal(init?.redirect,"error");
    if(String(url)==="https://github.com/login/oauth/access_token"){
      const body=new URLSearchParams(String(init?.body));exchangedVerifier=body.get("code_verifier")!;assert.equal(body.get("client_secret"),app.clientSecret);
      return Response.json({access_token:"ghu_fixture123",expires_in:28800,token_type:"bearer"});
    }
    if(String(url)==="https://api.github.com/user")return Response.json({login:"fixture"});
    if(String(url).includes("/user/repos?"))return Response.json([{private:true,full_name:"fixture/private"},{private:false,full_name:"fixture/public"},{private:true,full_name:"https://evil.test"}]);
    throw new Error("Unexpected endpoint");
  };
  try{
    paid=false;assert.equal((await get("connect")).status,402);assert.equal(requests.length,0);
    paid=true;const connect=await get("connect","?repo=https://github.com/fixture/private");assert.equal(connect.status,303);
    const flow=openGitHub(jar.get(real.GH_FLOW),"oauth",secret,flowSchema)!;
    assert.equal(flow.repo,"https://github.com/fixture/private");assert.equal(flow.customerId,customer.customerId);
    assert.equal((await get("callback","?code=fixture&state=wrong")).status,400);assert.equal(requests.length,0);
    await get("connect");const second=openGitHub(jar.get(real.GH_FLOW),"oauth",secret,flowSchema)!;
    customer={...customer,customerId:"cus_other"};assert.equal((await get("callback","?code=fixture&state="+second.state)).status,400);assert.equal(requests.length,0);
    customer={...customer,customerId:"cus_owner"};await get("connect","?repo=https://github.com/fixture/private");const third=openGitHub(jar.get(real.GH_FLOW),"oauth",secret,flowSchema)!;
    const callback=await get("callback","?code=fixture&state="+third.state);assert.equal(callback.status,303);assert.equal(exchangedVerifier,third.verifier);
    assert.ok(options.some(o=>o.httpOnly===true&&o.sameSite==="lax"&&o.path==="/"));
    const status=await get("status");const statusText=await status.text();assert.match(statusText,/"connected":true/);assert.doesNotMatch(statusText,/ghu_|clientSecret|client_secret/);
    const repos=await get("repositories");assert.deepEqual((await repos.json()).repositories,[{name:"fixture/private"}]);
    paid=false;assert.equal((await get("repositories")).status,402);paid=true;
    assert.equal((await get("callback","?code=fixture&state="+third.state)).status,400);
    const bad=new Request("https://fixture.test/api/github/disconnect",{method:"POST",headers:{Origin:"https://evil.test"}});assert.equal((await POST(bad,{params:Promise.resolve({action:"disconnect"})})).status,403);
    const good=new Request("https://fixture.test/api/github/disconnect",{method:"POST",headers:{Origin:"https://fixture.test"}});assert.equal((await POST(good,{params:Promise.resolve({action:"disconnect"})})).status,200);assert.equal(jar.has(real.GH_COOKIE),false);
    configured=false;assert.equal((await get("connect")).status,503);
    const tokenRequest = (token: string) => new Request("https://fixture.test/api/github/token", {method:"POST",headers:{Origin:"https://fixture.test","Content-Type":"application/json"},body:JSON.stringify({token})});
    paid=false; assert.equal((await POST(tokenRequest("ghp_fixture123"),{params:Promise.resolve({action:"token"})})).status,402); paid=true;
    assert.equal((await POST(tokenRequest("invalid"),{params:Promise.resolve({action:"token"})})).status,400);
    const stored=await POST(tokenRequest("ghp_fixture123"),{params:Promise.resolve({action:"token"})});assert.equal(stored.status,200);assert.doesNotMatch(await stored.text(),/ghp_/);
    assert.equal(openConnection(jar.get(real.GH_COOKIE),customer.customerId,secret)?.token,"ghp_fixture123");
    assert.deepEqual((await (await get("repositories")).json()).repositories,[{name:"fixture/private"}]);
    customer={...customer,customerId:"cus_other"};assert.equal((await get("repositories")).status,401);customer={...customer,customerId:"cus_owner"};

    const setupRoute=await import("../src/app/growth/github/[action]/route");
    const setupRequest=()=>new Request("https://fixture.test/growth/github/setup",{method:"POST",headers:{Origin:"https://fixture.test"}});
    assert.equal((await setupRoute.POST(setupRequest(),{params:Promise.resolve({action:"setup"})})).status,403);
    process.env.GROWTH_DASHBOARD_PASSWORD="fixture-owner-password-not-real-1234567890";jar.set("dd_growth",issueGrowthSession(process.env.GROWTH_DASHBOARD_PASSWORD));
    const setup=await setupRoute.POST(setupRequest(),{params:Promise.resolve({action:"setup"})});assert.equal(setup.status,200);assert.match(await setup.text(),/Continue to GitHub and review app/);
    assert.equal((await setupRoute.GET(new Request("https://fixture.test/growth/github/callback?code=fixture&state=wrong"),{params:Promise.resolve({action:"callback"})})).status,400);
    await setupRoute.POST(setupRequest(),{params:Promise.resolve({action:"setup"})});const ownerFlow=openGitHub(jar.get(real.GH_SETUP),"setup",secret,setupSchema)!;
    globalThis.fetch=async()=>Response.json({external_url:"https://fixture.test",permissions:{contents:"write"},client_id:app.clientId,client_secret:app.clientSecret,slug:app.slug});
    assert.equal((await setupRoute.GET(new Request("https://fixture.test/growth/github/callback?code=fixture&state="+ownerFlow.state),{params:Promise.resolve({action:"callback"})})).status,503);assert.equal(saved.length,0);
    await setupRoute.POST(setupRequest(),{params:Promise.resolve({action:"setup"})});const safeFlow=openGitHub(jar.get(real.GH_SETUP),"setup",secret,setupSchema)!;
    globalThis.fetch=async url=>{assert.match(String(url),/^https:\/\/api.github.com\/app-manifests\/fixture\/conversions$/);return Response.json({external_url:"https://fixture.test/",permissions:{contents:"read",metadata:"read"},client_id:app.clientId,client_secret:app.clientSecret,slug:app.slug,pem:"never-store-this-key",webhook_secret:"never-store-this-secret"});};
    const ownerCallback=await setupRoute.GET(new Request("https://fixture.test/growth/github/callback?code=fixture&state="+safeFlow.state),{params:Promise.resolve({action:"callback"})});assert.equal(ownerCallback.status,303);assert.deepEqual(saved,[app]);assert.equal(await ownerCallback.text(),"");
  }finally{globalThis.fetch=previousFetch;if(previousSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=previousSecret;if(previousEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previousEnv;if(previousOwner===undefined)delete process.env.GROWTH_DASHBOARD_PASSWORD;else process.env.GROWTH_DASHBOARD_PASSWORD=previousOwner;}
});
