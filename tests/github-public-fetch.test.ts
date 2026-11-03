import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {gzipSync} from "node:zlib";
import {pack} from "tar-stream";
const require=createRequire(import.meta.url);
require.cache[require.resolve("server-only")]={exports:{},loaded:true} as NodeModule;
require.cache[require.resolve("../src/lib/db")]={exports:{db:async()=>[],query:()=>"fixture"},loaded:true} as NodeModule;
let budget=0;
require.cache[require.resolve("../src/lib/work-budget")]={exports:{acquireWork:async(rules:unknown[])=>{if(rules.length)budget++;return "fixture";},releaseWork:async()=>{}},loaded:true} as NodeModule;

test("public snapshots recover repository, commit and archive 404s from a scoped service token without forwarding credentials",async()=>{
 const {analyzeGitHubRepository}=await import("../src/lib/github");
 const previousFetch=globalThis.fetch,previousToken=process.env.GITHUB_TOKEN,previousSecret=process.env.SESSION_SECRET;
 process.env.GITHUB_TOKEN="fixture-service";process.env.SESSION_SECRET="fixture-session-key-for-public-archive-123456789";
 const tar=pack();tar.entry({name:"snapshot/package.json"},'{"scripts":{"build":"vite build"},"dependencies":{"vite":"7"}}');tar.entry({name:"snapshot/src/main.ts"},'export const x=1;');tar.finalize();const chunks:Buffer[]=[];for await(const chunk of tar)chunks.push(chunk);const compressed=gzipSync(Buffer.concat(chunks));
 const sha="c".repeat(40),calls:Array<{url:string;auth:boolean}>=[];budget=0;
 globalThis.fetch=async(input,init)=>{const url=String(input),auth=new Headers(init?.headers).has("authorization");calls.push({url,auth});
  if(auth)return new Response('{}',{status:404,headers:{"x-ratelimit-remaining":"100"}});
  if(url.endsWith('/repos/fixture/public'))return Response.json({private:false,default_branch:"main"});
  if(url.endsWith('/commits/main'))return Response.json({sha});
  if(url.endsWith('/tarball/'+sha))return new Response(null,{status:302,headers:{location:"https://codeload.github.com/fixture/public/tar.gz/"+sha}});
  if(url.startsWith('https://codeload.github.com/'))return new Response(compressed);
  throw Error("unexpected fixture request");};
 try{const result=await analyzeGitHubRepository("https://github.com/fixture/public");assert.equal(result.results.repository.commitSha,sha);assert.equal(result.isPrivate,false);assert.equal(calls.length,7);assert.equal(budget,6);assert.ok(calls.filter(c=>c.url.includes('codeload')).every(c=>!c.auth));}
 finally{globalThis.fetch=previousFetch;if(previousToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=previousToken;if(previousSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=previousSecret;}
});
test("public recovery never retries buyer tokens, unauthorized/rate-limited responses, or a failed anonymous read",async()=>{
 const {githubRequest,GitHubApiError}=await import("../src/lib/github");const previousFetch=globalThis.fetch,previousToken=process.env.GITHUB_TOKEN;process.env.GITHUB_TOKEN="fixture-service";
 try{
  for(const scenario of [{status:404,user:true,headers:{}},{status:401,user:false,headers:{}},{status:403,user:false,headers:{}},{status:429,user:false,headers:{}},{status:404,user:false,headers:{"x-ratelimit-remaining":"0"}},{status:404,user:false,headers:{"retry-after":"30"}}]){
   let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:scenario.status,headers:scenario.headers as Record<string,string>});};
   await assert.rejects(()=>githubRequest('/repos/fixture/private',"fixture-service",scenario.user),GitHubApiError);assert.equal(calls,1);
  }
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:404});};await assert.rejects(()=>githubRequest('/repos/fixture/private',"fixture-service"),GitHubApiError);assert.equal(calls,2);
 }finally{globalThis.fetch=previousFetch;if(previousToken===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=previousToken;}
});
