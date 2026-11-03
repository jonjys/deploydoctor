import test from "node:test";
import assert from "node:assert/strict";
import { auditHosting, HOST_CONFIG_FILE, hostingPlatforms } from "../src/lib/hosting-config";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { reportJson } from "../src/lib/report-json";
const snapshot = (files: Record<string,string>, partial=false): RepositorySnapshot => ({ owner:"fixture",name:"multi-host",defaultBranch:"main",entries:Object.keys(files).map(path=>({path,type:"blob"})),contents:new Map(Object.entries(files)),sourceFilesFound:Object.keys(files).filter(f=>/\.[jt]s$/.test(f)).length,sourceFilesRead:Object.keys(files).filter(f=>/\.[jt]s$/.test(f)).length,partial });
const manifest = JSON.stringify({scripts:{build:"vite build"},dependencies:{vite:"^7",react:"^19"}});
const rules = (files:Record<string,string>,partial=false) => auditHosting(snapshot(files,partial)).findings;
const found = (files:Record<string,string>,rule:string,partial=false) => rules(files,partial).filter(f=>f.ruleId===rule);
const worker = (config: Record<string,unknown>)=>({"wrangler.jsonc":JSON.stringify({name:"fixture",compatibility_date:"2026-09-01",...config})});

test("Cloudflare JSON, JSONC, Netlify, Railway and Docker config discovery shares the file-selection policy",()=>{
 for(const file of ["wrangler.json","wrangler.jsonc","wrangler.toml","netlify.toml","railway.json","railway.toml","Dockerfile","Dockerfile.production",".railway/railway.ts","apps/site/package.json"].filter(f=>!f.endsWith("package.json")))assert.equal(HOST_CONFIG_FILE.test(file),true,file);
 assert.deepEqual(hostingPlatforms(["wrangler.json","netlify.toml","railway.json","Dockerfile"]),["Netlify","Cloudflare","Railway","Docker"]);
 assert.deepEqual(hostingPlatforms(["Cargo.toml","src/main.rs"]),[]);
 assert.deepEqual(hostingPlatforms(["tests/fixtures/wrangler.json", "node_modules/library/netlify.toml"]),[]);
});
test("Wrangler JSONC comments and trailing commas parse as data; malformed configuration is a real syntax finding",()=>{
 const good={"wrangler.jsonc":'{\n// worker config\n"name":"fixture",\n"compatibility_date":"2026-09-01",\n"main":"src/index.ts",\n}',"src/index.ts":"export default {}"};
 assert.equal(found(good,"hosting-config-syntax").length,0);
 assert.equal(found({"wrangler.json":"{broken"},"hosting-config-syntax")[0].status,"red");
 assert.equal(found({"wrangler.toml":"main = ["},"hosting-config-syntax")[0].status,"red");
 const result=auditHosting(snapshot(good));assert.ok(result.filesRead.includes("wrangler.jsonc"));assert.ok(result.evaluatedRules.includes("cloudflare-entrypoint"));
});
test("Worker entrypoints distinguish real casing errors, generated outputs and partial trees",()=>{
 const wrong={...worker({main:"src/Index.ts"}),"src/index.ts":"export default {}"};
 assert.equal(found(wrong,"cloudflare-entrypoint")[0].status,"red");
 assert.equal(found(wrong,"cloudflare-entrypoint",true)[0].status,"yellow");
 assert.equal(found({...worker({main:".open-next/worker.js"}),"package.json":manifest},"cloudflare-entrypoint")[0].status,"yellow");
 assert.equal(found(worker({main:"src/generated.ts",build:{command:"generate-worker"}}),"cloudflare-entrypoint")[0].status,"yellow");
 assert.equal(found({...worker({main:"src/index.ts"}),"src/index.ts":"export default {}"},"cloudflare-entrypoint").length,0);
 assert.equal(found(worker({assets:{directory:"dist"}}),"cloudflare-entrypoint").length,0,"assets-only Worker needs no main");
});
test("calendar dates are validated with correct nested JSON and TOML evidence locations",()=>{
 const json={"wrangler.jsonc":'{\n"compatibility_date":"2026-09-01",\n"env":{"staging":{\n"compatibility_date":"2026-02-30"\n}}\n}'};
 const f=found(json,"cloudflare-compatibility-date")[0];assert.equal(f.status,"yellow");assert.equal(f.line,4);
 const toml={"wrangler.toml":'compatibility_date="2026-09-01"\n[env.staging]\ncompatibility_date="2026-02-30"'};
 assert.equal(found(toml,"cloudflare-compatibility-date")[0].line,3);
 assert.equal(found(worker({compatibility_date:"2024-02-29"}),"cloudflare-compatibility-date").length,0);
 assert.equal(found({"wrangler.json":"{}"},"cloudflare-compatibility-date")[0].status,"yellow");
});
test("Node compatibility honors 2026 defaults, explicit flags, AST imports, reexports and local import chains",()=>{
 const source={"src/index.ts":'export {x} from "./helper";',"src/helper.ts":'import {createHash} from "node:crypto"; export const x = createHash;'};
 const old={...worker({main:"src/index.ts",compatibility_date:"2025-01-01"}),...source};
 const risk=found(old,"cloudflare-node-compatibility");assert.equal(risk.length,1);assert.equal(risk[0].file,"src/helper.ts");assert.equal(risk[0].status,"yellow");
 assert.equal(found({...worker({main:"src/index.ts"}),...source},"cloudflare-node-compatibility").length,0,"new compatibility dates need no explicit positive flag");
 assert.equal(found({...worker({main:"src/index.ts",compatibility_date:"2025-01-01",compatibility_flags:["nodejs_compat"]}),...source},"cloudflare-node-compatibility").length,0);
 assert.equal(found({...worker({main:"src/index.ts",compatibility_flags:["no_nodejs_compat","no_nodejs_compat_v2"]}),...source},"cloudflare-node-compatibility").length,1);
 const harmless={...old,"src/helper.ts":'// import "node:fs";\nconst doc = "require(\\\"node:fs\\\")"; import type {Stats} from "node:fs"; export const x=1;'};
 assert.equal(found(harmless,"cloudflare-node-compatibility").length,0);
});
test("duplicate bindings are scoped per environment and assets/files are not interchangeable",()=>{
 const binding=worker({kv_namespaces:[{binding:"DATA",id:"fixture"}],r2_buckets:[{binding:"DATA",bucket_name:"fixture"}]});
 assert.equal(found(binding,"cloudflare-binding-collision").length,1);
 const separate=worker({kv_namespaces:[{binding:"DATA",id:"fixture"}],env:{staging:{kv_namespaces:[{binding:"DATA",id:"fixture-staging"}]}}});
 assert.equal(found(separate,"cloudflare-binding-collision").length,0);
 assert.equal(found({...worker({assets:{directory:"src/index.ts"}}),"src/index.ts":"export default {}"},"cloudflare-assets-directory")[0].status,"red");
 assert.equal(found(worker({main:"dist/worker.js",pages_build_output_dir:"dist"}),"cloudflare-pages-worker-config")[0].status,"yellow");
});
test("multiple Wrangler files and unread configuration are explicit coverage limitations",()=>{
 const s=snapshot({...worker({}),"wrangler.toml":'compatibility_date="2026-09-01"'});
 assert.ok(auditHosting(s).limitations.some(l=>l.includes("Multiple Wrangler")));
 s.contents.delete("wrangler.toml");assert.ok(auditHosting(s).limitations.some(l=>l.includes("was not read")));
});
test("Netlify bases and nested/context scripts use the correct package manifest",()=>{
 const config='[build]\nbase="apps/site"\ncommand="pnpm build"\n[context.deploy-preview]\ncommand="pnpm run preview-build"';
 const files={"netlify.toml":config,"apps/site/package.json":JSON.stringify({scripts:{build:"vite build"}}),"apps/site/src/index.ts":"export {}"};
 const f=found(files,"netlify-context-build-script");assert.equal(f.length,1);assert.equal(f[0].status,"yellow");assert.equal(f[0].line,5);assert.match(f[0].problem,/preview-build/);
 assert.equal(found({...files,"apps/site/package.json":JSON.stringify({scripts:{build:"vite build","preview-build":"vite build"}})},"netlify-context-build-script").length,0);
 assert.equal(found({"netlify.toml":'[build]\nbase="missing"',"package.json":manifest},"netlify-base-directory")[0].status,"red");
 assert.equal(found({"netlify.toml":'[build]\nbase="missing"',"package.json":manifest},"netlify-base-directory",true).length,0);
 assert.equal(found({"netlify.toml":'[build]\nbase="."',"package.json":manifest},"netlify-base-directory").length,0);
 for (const command of ["pnpm install", "yarn install", "pnpm exec", "yarn version"]) assert.equal(found({"netlify.toml":`[build]\ncommand="${command}"`,"package.json":manifest},"netlify-context-build-script").length,0);
});
test("Netlify redirect ordering detects forced SPA shadowing and avoids conditional or correctly ordered rules",()=>{
 const spa='[[redirects]]\nfrom="/*"\nto="/index.html"\nstatus=200\nforce=true\n', api='[[redirects]]\nfrom="/api/*"\nto="/.netlify/functions/api/:splat"\nstatus=200\n';
 assert.equal(found({"netlify.toml":spa+api},"netlify-forced-spa-shadow").length,1);
 assert.equal(found({"netlify.toml":api+spa},"netlify-forced-spa-shadow").length,0);
 assert.equal(found({"netlify.toml":spa.replace('force=true','force=false')+api},"netlify-forced-spa-shadow").length,0);
 assert.equal(found({"netlify.toml":spa.replace('force=true','force=true\nconditions={Role=["admin"]}')+api},"netlify-forced-spa-shadow").length,0);
 const loop='[[redirects]]\nfrom="/same"\nto="/same"\nstatus=301';
 assert.equal(found({"netlify.toml":loop},"netlify-redirect-loop")[0].status,"yellow");
 assert.equal(found({"netlify.toml":loop.replace('status=301','status=200')},"netlify-redirect-loop").length,0);
});
test("Netlify edge path syntax is specific, not a demand for all regex patterns to start with slash",()=>{
 assert.equal(found({"netlify.toml":'[[edge_functions]]\nfunction="geo"\npath="api/*"'},"netlify-edge-path")[0].status,"red");
 for(const config of ['[[edge_functions]]\nfunction="geo"\npath="/api/*"','[[edge_functions]]\nfunction="geo"\npattern="^/api/.*$"'])assert.equal(found({"netlify.toml":config},"netlify-edge-path").length,0);
});
test("Railway paths and Docker secret-layer risks stay reviewable without pretending to know service settings",()=>{
 const railway={"railway.json":JSON.stringify({build:{dockerfilePath:"Dockerfile.api"}})};
 assert.equal(found(railway,"railway-dockerfile-path")[0].status,"yellow");
 assert.equal(found({...railway,"Dockerfile.api":"FROM node:24"},"railway-dockerfile-path").length,0);
 assert.ok(auditHosting(snapshot({".railway/railway.ts":"throw new Error('must not execute')"})).limitations.some(l=>l.includes("not executed")));
 assert.equal(found({"Dockerfile":"FROM node:24\nCOPY .env /app/.env\n"},"docker-env-copy")[0].line,2);
 for(const source of ["# COPY .env /app/.env","COPY .env.example /app/.env.example","COPY . /app"])assert.equal(found({"Dockerfile":source},"docker-env-copy").length,0);
});
test("explicit non-Vercel hosts do not get Vercel adapter, Node-version, SQLite or SPA-rewrite advice",()=>{
 const files={"netlify.toml":'[build]\ncommand="npm run build"',"package.json":JSON.stringify({scripts:{build:"vite build",postinstall:"prisma generate"},engines:{node:"18.x"},dependencies:{vite:"^7","@sveltejs/kit":"^2","@prisma/client":"^6",prisma:"^6","better-sqlite3":"^12"}}),"svelte.config.js":'import adapter from "@sveltejs/adapter-netlify";export default {kit:{adapter:adapter()}}',"src/app.ts":'import {createBrowserRouter} from "react-router-dom";',"prisma/schema.prisma":'datasource db { provider = "sqlite" url = "file:./db.sqlite" }'};
 const r=analyzeSnapshot(snapshot(files));
 const build=r.checks.find(c=>c.id==="build-config")!;assert.ok(!build.findings?.some(f=>/Vercel|vercel\.json|Node 20, 22|adapter-netlify/.test(f.problem)));
 assert.notEqual(r.checks.find(c=>c.id==="server-libs")?.status,"red");assert.notEqual(r.checks.find(c=>c.id==="prisma")?.status,"red");
 assert.ok(r.hosting?.platforms.includes("Netlify"));
});
test("platform checks respect category selection and reach report JSON and Launch Readiness with limits",()=>{
 const files={...worker({main:"src/Missing.ts"}),"package.json":manifest};
 const all=analyzeSnapshot(snapshot(files)),env=analyzeSnapshot(snapshot(files),{checks:["env"]});
 assert.ok(all.checks.find(c=>c.id==="build-config")?.findings?.some(f=>f.ruleId==="cloudflare-entrypoint"));
 assert.equal(env.hosting?.findings.length,0);assert.equal(env.hosting?.evaluatedRules.length,0);
 const json=reportJson({id:"fixture",repo_url:"https://github.com/fixture/multi-host",created_at:all.checkedAt,results:all});
 assert.ok(json.hosting?.filesRead.includes("wrangler.jsonc"));assert.ok(json.launchReadiness.notVerified.some(l=>l.includes("Dashboard")));
 assert.ok(json.checks.every(c=>c.findings.every(f=>f.file&&f.line>0&&f.fix)));
});

test("ambiguous config selection downgrades certainty and nested configs are recognized without invented root coverage",()=>{
 const ambiguous={"wrangler.json":"{broken","wrangler.toml":'compatibility_date="2026-09-01"'};
 assert.equal(found(ambiguous,"hosting-config-syntax")[0].status,"yellow");
 const nested=auditHosting(snapshot({"apps/worker/wrangler.jsonc":'{"main":"index.ts"}'}));
 assert.ok(nested.platforms.includes("Cloudflare"));assert.equal(nested.filesRead.length,0);assert.ok(nested.limitations.some(l=>l.includes("root hosting configs only")));
});
test("environment and finding budgets remain finite and report coverage caps instead of silently claiming completion",()=>{
 const env=Object.fromEntries(Array.from({length:40},(_,i)=>[`env${i}`,{compatibility_date:"invalid"}]));
 const result=auditHosting(snapshot(worker({env})));
 assert.ok(result.findings.length<=100);assert.ok(result.limitations.some(l=>l.includes("first 32")));
 assert.ok(result.findings.filter(f=>f.problem.includes("env.")).every(f=>f.status==="yellow"));
 const bindings=Array.from({length:150},()=>({binding:"DATA",id:"fixture"}));
 const capped=auditHosting(snapshot(worker({kv_namespaces:bindings})));assert.equal(capped.findings.length,100);assert.ok(capped.limitations.includes("Platform finding limit reached."));
});
