import test from "node:test";
import assert from "node:assert/strict";
import { deploymentInventory, createDeployHandoff, handoffMarkdown } from "../src/lib/deploy-handoff";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { comparePullRequest } from "../src/lib/pr-impact";
import { reportJson } from "../src/lib/report-json";
const a="a".repeat(40),b="b".repeat(40);
const snapshot=(files:Record<string,string>,partial=false):RepositorySnapshot=>({owner:"fixture",name:"shop",defaultBranch:"main",entries:Object.keys(files).map(path=>({path,type:"blob"})),contents:new Map(Object.entries(files)),partial,sourceFilesFound:0,sourceFilesRead:0});
const result=(files:Record<string,string>,sha:string,partial=false)=>{const r=analyzeSnapshot(snapshot(files,partial));r.repository.commitSha=sha;return r;};
const compare=(old:Record<string,string>,now:Record<string,string>,partial=false)=>createDeployHandoff(result(old,a),result(now,b,partial))!;

test("environment inventory uses AST, not comments, strings, examples or dynamic names",()=>{
 const inventory=deploymentInventory(snapshot({"src/config.ts":`// process.env.FAKE_COMMENT\nconst docs='process.env.FAKE_STRING';\nconst x=process.env.REAL_KEY;const y=import.meta.env.VITE_API_URL;const z=process.env['OTHER_KEY'];const {THIRD_KEY: alias}=process.env;const unknown=process.env[name];`,"tests/fixture.ts":"process.env.TEST_KEY","examples/demo.ts":"process.env.DEMO_KEY"}));
 assert.deepEqual(inventory.items.map(i=>i.key).sort(),["OTHER_KEY","REAL_KEY","THIRD_KEY","VITE_API_URL"]);assert.equal(inventory.items.find(i=>i.key==="REAL_KEY")?.line,3);
});
test("new environment references create manual setup tasks, including optional references, without asserting hosting values",()=>{
 const h=compare({"src/a.ts":"const old=process.env.OLD;"},{"src/a.ts":"const old=process.env.OLD;const key=process.env.NEW_KEY ?? 'optional';"});
 assert.equal(h.tasks.length,1);assert.match(h.tasks[0].title,/NEW_KEY/);assert.equal(h.tasks[0].confidence,"observed-change");assert.match(h.tasks[0].action,/required or optional/);assert.match(h.tasks[0].verification,/cannot read hosting values/);
 assert.ok(h.manualChecks.every(c=>!c.includes("passed")));
});
test("moved environment references, line movement, builtins and unchanged configuration do not invent work",()=>{
 const old={"src/a.ts":"const x=process.env.KEY;","fly.toml":"app='test'"};
 const now={"src/moved.ts":"\nconst x=process.env.KEY;const p=process.env.PORT;const n=process.env.NODE_ENV;","fly.toml":"app='test'"};
 assert.equal(compare(old,now).tasks.length,0);
});
test("database, build and hosting changes produce pinned review tasks without exposing source values",()=>{
 const h=compare({"package.json":'{"scripts":{"build":"old"}}',"wrangler.toml":"name='old'"},{"package.json":'{"scripts":{"build":"echo NEVER_EXPOSE_THIS_VALUE"}}',"wrangler.toml":"name='new'\nsecret='NEVER_EXPOSE_THIS_VALUE'","supabase/migrations/001.sql":"CREATE TABLE private_table(id integer);"});
 assert.deepEqual(h.tasks.map(t=>t.kind).sort(),["build","hosting","migration"]);assert.equal(h.baseCommitSha,a);assert.equal(h.headCommitSha,b);
 assert.doesNotMatch(JSON.stringify(h),/NEVER_EXPOSE_THIS_VALUE|CREATE TABLE|private_table/);
 assert.doesNotMatch(JSON.stringify(result({"package.json":'{"scripts":{"build":"echo NEVER_EXPOSE_THIS_VALUE"}}'},b).deploymentInventory),/NEVER_EXPOSE_THIS_VALUE/);
 const markdown=handoffMarkdown(h,"https://example.com/report");assert.match(markdown,/- \[ \]/);assert.ok(markdown.includes(b));assert.match(markdown,/not run an unreviewed migration/i);
});
test("endpoint removal has base evidence and GitHub-proven renames do not masquerade as removal",()=>{
 const old=result({"app/api/old/route.ts":"export function GET(){return new Response('ok')}"},a),now=result({"app/api/new/route.ts":"export function GET(){return new Response('ok')}"},b);
 const tasks=createDeployHandoff(old,now)!.tasks;assert.equal(tasks.length,2);assert.equal(tasks.find(t=>t.change==="removed")?.side,"base");
 assert.equal(createDeployHandoff(old,now,{"app/api/old/route.ts":"app/api/new/route.ts"})!.tasks.length,0);
});
test("partial coverage, parse errors and truncated rename data stay review candidates",()=>{
 const h=compare({}, {"src/config.ts":"process.env.API_KEY;"},true);assert.equal(h.complete,false);assert.ok(h.tasks.every(t=>t.confidence==="needs-review"));
 const malformed=deploymentInventory(snapshot({"src/config.ts":"const broken = ; process.env.KEY"}));assert.equal(malformed.complete,false);assert.equal(malformed.items.length,0);
 const h2=createDeployHandoff(result({},a),result({"src/config.ts":"process.env.API_KEY;"},b),{},false)!;assert.equal(h2.tasks[0].confidence,"needs-review");
});
test("legacy reports, invalid commits, other repositories and excluded categories never receive a fabricated checklist",()=>{
 const old=result({},a),now=result({},b);delete old.deploymentInventory;assert.equal(createDeployHandoff(old,now),undefined);
 const invalid=result({},"not-a-sha");assert.equal(createDeployHandoff(invalid,now),undefined);
 const other=result({},a);other.repository.name="other";assert.equal(createDeployHandoff(other,now),undefined);
 assert.equal(analyzeSnapshot(snapshot({"src/env.ts":"process.env.KEY"}),{checks:["env"]}).deploymentInventory,undefined);
});
test("inventory and release-task budgets stay explicit",()=>{
 const inventory=deploymentInventory(snapshot({"src/env.ts":Array.from({length:350},(_,i)=>`process.env.KEY_${i};`).join('\n')}));assert.equal(inventory.items.length,300);assert.equal(inventory.complete,false);assert.ok(inventory.limitations.some(l=>l.includes("limit")));
 const h=compare({}, {"src/env.ts":Array.from({length:50},(_,i)=>`process.env.KEY_${i};`).join('\n')});assert.equal(h.tasks.length,40);assert.equal(h.complete,false);
});
test("the existing PR comparison and report JSON carry handoff without changing check results or old reports",()=>{
 const old=result({},a),now=result({"src/config.ts":"const x=process.env.NEW_PRODUCTION_SETTING;"},b);const before=JSON.stringify(now.checks);
 const impact=comparePullRequest(old,now,{number:9,url:"https://github.com/fixture/shop/pull/9",baseRef:"main",baseCommitSha:a,headCommitSha:b});assert.ok(impact.handoff?.tasks.some(t=>t.kind==="environment"));now.pullRequest=impact;
 const json=reportJson({id:"fixture",repo_url:"https://github.com/fixture/shop",created_at:now.checkedAt,results:now,is_private:true});assert.equal(json.deployHandoff?.headCommitSha,b);assert.equal(JSON.stringify(now.checks),before);assert.equal(json.isPrivate,true);
 delete now.pullRequest;assert.equal(reportJson({id:"legacy",repo_url:"https://github.com/fixture/shop",created_at:now.checkedAt,results:now}).deployHandoff,null);
});


test("shadowed process objects and type-only queries cannot invent production environment requirements",()=>{
 const local=deploymentInventory(snapshot({"src/config.ts":"const process={env:{FAKE:'local'}};const x=process.env.FAKE;"}));assert.equal(local.items.length,0);assert.equal(local.complete,false);
 const typed=deploymentInventory(snapshot({"src/config.ts":"type Fake = typeof process.env.TYPE_ONLY; const x=process.env.REAL;"}));assert.deepEqual(typed.items.map(i=>i.key),["REAL"]);
});
