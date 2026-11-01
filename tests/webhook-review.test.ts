import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { reviewWebhook,webhookInput,WEBHOOK_INPUT_LIMIT } from "../src/lib/webhook-review";
import { WEBHOOK_EXAMPLE } from "../src/lib/webhook-example";
import { webhookContract,webhookContractInstructions } from "../src/lib/webhook-contract";

test("pasted webhook reuses real AST findings with line evidence and explicit limited coverage",()=>{
 const result=reviewWebhook({framework:"next-app",source:WEBHOOK_EXAMPLE,schema:"",schemaType:"sql"});
 assert.equal(result.codeStored,false);assert.equal(result.aiUsed,false);assert.equal(result.status,"review");
 assert.ok(result.findings.some(f=>f.ruleId==="stripe-raw-body"));assert.ok(result.findings.some(f=>f.ruleId==="stripe-idempotency-unestablished"));
 for(const f of result.findings){assert.ok(f.line>0);assert.equal(f.excerpt,WEBHOOK_EXAMPLE.split("\n")[f.line-1]);assert.ok(f.problem&&f.fix);}
 assert.ok(result.limitations.some(l=>l.includes("No webhook")));
});
test("comments, strings and invalid syntax cannot become a clean bill of payment safety",()=>{
 const source='// stripe.webhooks.constructEvent(JSON.stringify(payload))\nexport async function POST(req) { return Response.json({ message: "stripe.webhooks.constructEvent" }); }';
 for(const code of [source,'export async function POST( {{ invalid']){
 const result=reviewWebhook({framework:"next-app",source:code,schema:"",schemaType:"sql"});assert.equal(result.status,"inconclusive");assert.equal(result.findings.length,0);assert.match(result.summary,/cannot establish/);
 }
});
test("supplied Prisma uniqueness adds evidence without claiming to inspect a live database",()=>{
 const source=`import Stripe from "stripe";
import { prisma } from "@/lib/db";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
export async function POST(req: Request) {
 const event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature")!, process.env.STRIPE_WEBHOOK_SECRET!);
 const session = event.data.object as Stripe.Checkout.Session;
 await prisma.processedEvent.create({ data: { id: event.id } });
 await prisma.order.create({ data: { sessionId: session.id } });
 return Response.json({ received: true });
}`;
 const schema='model ProcessedEvent {\n id String @id\n}\nmodel Order {\n id String @id @default(cuid())\n sessionId String\n}';
 const result=reviewWebhook({framework:"next-app",source,schema,schemaType:"prisma"});assert.equal(result.findings.some(f=>f.ruleId?.includes("idempotency")),false);assert.equal(result.status,"inconclusive");assert.ok(result.limitations.some(l=>l.includes("live database")));
});
test("code is data only, source and schema sizes are bounded, and recognized credentials are refused",()=>{
 const marker="globalThis.DO_NOT_EXECUTE_CUSTOMER_SOURCE = true;";
 reviewWebhook({framework:"express",source:marker,schema:"",schemaType:"sql"});assert.equal("DO_NOT_EXECUTE_CUSTOMER_SOURCE" in globalThis,false);
 assert.equal(webhookInput.safeParse({framework:"next-app",source:"a".repeat(40_001)}).success,false);
 assert.equal(webhookInput.safeParse({framework:"next-app",source:marker,schema:"a".repeat(30_001)}).success,false);
 assert.equal(webhookInput.safeParse({framework:"next-app",source:marker,url:"https://evil.test"}).success,false);
 const credential="sk_live_"+"r7G2m9Q8v4B6c5N3p0Z1y8L9a2F4";
 assert.throws(()=>reviewWebhook({framework:"express",source:`const key = "${credential}";`,schema:"",schemaType:"sql"}),/Remove credentials/);
});
test("generated contract fails until configured, passes a correct fixture and catches repeated business actions",()=>{
 const dir=mkdtempSync(join(tmpdir(),"dd-contract-"));
 try{
 const file=join(dir,"proof.test.mjs");writeFileSync(file,webhookContract());
 const env={...process.env};delete env.DEPLOYDOCTOR_WEBHOOK_ADAPTER;delete env.NODE_TEST_CONTEXT;
 const missing=spawnSync(process.execPath,["--test",file],{env,encoding:"utf8",timeout:20_000});assert.notEqual(missing.status,0,missing.stdout+missing.stderr);assert.match(missing.stdout,/No application was tested/);
 const good=join(dir,"good.mjs");writeFileSync(good,`export async function createHarness() { let done=false, count=0, fail=false;return {async deliver(){const tentativeClaim=true;if(fail){fail=false;throw new Error('injected after tentative claim');}if(tentativeClaim&&!done){done=true;count++;}},async applications(){return count;},async restart(){},async failNextBeforeFulfillment(){fail=true;},async dispose(){}};}`);
 const pass=spawnSync(process.execPath,["--test",file],{env:{...env,DEPLOYDOCTOR_WEBHOOK_ADAPTER:good},encoding:"utf8",timeout:20_000});assert.equal(pass.status,0,pass.stdout+pass.stderr);assert.match(pass.stdout,/pass 5/);
 const bad=join(dir,"bad.mjs");writeFileSync(bad,`export async function createHarness(){let count=0,fail=false;return{async deliver(){if(fail){fail=false;throw Error('injected');}count++;},async applications(){return count;},async restart(){},async failNextBeforeFulfillment(){fail=true;},async dispose(){}};}`);
 const rejected=spawnSync(process.execPath,["--test",file],{env:{...env,DEPLOYDOCTOR_WEBHOOK_ADAPTER:bad},encoding:"utf8",timeout:20_000});assert.notEqual(rejected.status,0);assert.match(rejected.stdout,/fail 4/);
 assert.doesNotMatch(webhookContract(),/fetch\(|https:\/\/|sk_live_/);assert.match(webhookContractInstructions(),/AFTER your event claim/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("review route enforces origin, shared scan allowance, server entitlements, bounded input and release",async()=>{
 const require=createRequire(import.meta.url);require.cache[require.resolve("server-only")]={exports:{},loaded:true} as NodeModule;
 let paid=false,allowed=true,invalidToken=false,limited=false;let reservations=0,leases=0,releases=0;const finishes:{id:string,success:boolean}[]=[];
 require.cache[require.resolve("../src/lib/access")]={exports:{requestCustomer:async()=>({customer:paid?{customerId:"cus_fixture"}:null,invalidToken}),activePlan:async()=>paid?{plan:"week"}:null,hashRequestIp:()=>"fixture",reserveScan:async(_request:Request,allowance:{limit:number})=>{assert.equal(allowance.limit,1);reservations++;return {allowed,id:"fixture"};},finishScan:async(id:string,success:boolean)=>{finishes.push({id,success});}} ,loaded:true} as NodeModule;
 const work=require("../src/lib/work-budget");require.cache[require.resolve("../src/lib/work-budget")]!.exports={...work,acquireWork:async()=>{leases++;if(limited)throw new work.WorkLimitError(30);return "lease";},releaseWork:async()=>{releases++;}};
 const {POST}=await import("../src/app/api/webhook-review/route");
 const request=(body:string,origin="https://fixture.test")=>new Request("https://fixture.test/api/webhook-review",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body});
 const body=JSON.stringify({framework:"next-app",source:WEBHOOK_EXAMPLE});
 assert.equal((await POST(request(body,"https://evil.test"))).status,403);assert.equal(reservations,0);
 assert.equal((await POST(request("a".repeat(WEBHOOK_INPUT_LIMIT+1)))).status,413);assert.equal(leases,0);
 assert.equal((await POST(request("{"))).status,400);assert.equal(reservations,0);
 const secret="sk_live_"+"r7G2m9Q8v4B6c5N3p0Z1y8L9a2F4";const blocked=await POST(request(JSON.stringify({framework:"express",source:`const key = "${secret}";`})));assert.equal(blocked.status,400);assert.doesNotMatch(await blocked.text(),/r7G2/);assert.equal(leases,0);
 invalidToken=true;assert.equal((await POST(request(body))).status,401);invalidToken=false;
 allowed=false;assert.equal((await POST(request(body))).status,402);assert.equal(releases,1);assert.equal(finishes.length,0);allowed=true;
 const result=await POST(request(body));assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");assert.deepEqual(finishes,[{id:"fixture",success:true}]);assert.equal(releases,2);
 const before=reservations;paid=true;assert.equal((await POST(request(body))).status,200);assert.equal(reservations,before);assert.equal(releases,3);
 limited=true;assert.equal((await POST(request(body))).status,429);assert.equal(reservations,before);
});
