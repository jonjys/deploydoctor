import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";

test("the real GitHub archive pipeline reads Wrangler JSON and nested Netlify manifests, pins the commit and never runs source", async()=>{
 const require=createRequire(import.meta.url);
 require.cache[require.resolve("server-only")]={exports:{},loaded:true} as NodeModule;
 require.cache[require.resolve("../src/lib/db")]={exports:{db:async()=>[],query:()=>"fixture"},loaded:true} as NodeModule;
 const leases:unknown[][]=[];
 require.cache[require.resolve("../src/lib/work-budget")]={exports:{acquireWork:async(...args:unknown[])=>{leases.push(args);return "lease";},releaseWork:async()=>{}},loaded:true} as NodeModule;
 const files={"wrangler.json":JSON.stringify({name:"fixture",compatibility_date:"2026-09-01",main:"src/Worker.ts"}),"src/worker.ts":"throw new Error('REPOSITORY_CODE_MUST_NOT_EXECUTE');", "netlify.toml":'[build]\nbase="apps/site"\ncommand="pnpm run missing-build"',"apps/site/package.json":JSON.stringify({scripts:{build:"vite build"}})};
 const tar=pack();for(const [file,text] of Object.entries(files))tar.entry({name:`fixture-head/${file}`},text);tar.finalize();const chunks:Buffer[]=[];for await(const chunk of tar)chunks.push(chunk);const compressed=gzipSync(Buffer.concat(chunks));
 const previousFetch=globalThis.fetch, previousToken=process.env.GITHUB_TOKEN, previousSecret=process.env.SESSION_SECRET;delete process.env.GITHUB_TOKEN;process.env.SESSION_SECRET="fixture-only-session-key-for-archive-test-123456789";
 const calls:Array<{url:string;headers:Headers}> = [],sha="d".repeat(40);
 globalThis.fetch=async(input,init)=>{
  const url=String(input);calls.push({url,headers:new Headers(init?.headers)});
  if(url.endsWith('/repos/fixture/hosts'))return Response.json({private:false,default_branch:"main"});
  if(url.endsWith('/commits/main'))return Response.json({sha});
  if(url.endsWith(`/tarball/${sha}`))return new Response(null,{status:302,headers:{location:"https://codeload.github.com/fixture/hosts/tar.gz/"+sha}});
  if(url.startsWith("https://codeload.github.com/"))return new Response(compressed);
  throw new Error("Unexpected request: "+url);
 };
 try{
  const {analyzeGitHubRepository}=await import("../src/lib/github");
  const result=await analyzeGitHubRepository("https://github.com/fixture/hosts");
  assert.equal(result.results.repository.commitSha,sha);assert.equal(result.results.scan.partial,false);assert.equal(result.isPrivate,false);
  const findings=result.results.checks.flatMap(c=>c.findings??[]);
  assert.ok(findings.some(f=>f.ruleId==="cloudflare-entrypoint"&&f.status==="red"));
  assert.ok(findings.some(f=>f.ruleId==="netlify-context-build-script"&&f.problem.includes("apps/site/package.json")));
  assert.ok(result.results.hosting?.filesRead.includes("wrangler.json"));assert.equal(calls.length,4);
  assert.ok(calls.filter(c=>c.url.includes("codeload")).every(c=>!c.headers.has("authorization")));
  assert.ok(leases.some(args=>args[1]==="repository-download"));
 }finally{globalThis.fetch=previousFetch;if(previousToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=previousToken;if(previousSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=previousSecret;}
});
