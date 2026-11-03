import test from "node:test";
import assert from "node:assert/strict";
import { auditHosting, HOST_CONFIG_FILE, hostingPlatforms } from "../src/lib/hosting-config";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { reportJson } from "../src/lib/report-json";
const snapshot = (files: Record<string,string>, partial=false, gitRef?: string): RepositorySnapshot => ({owner:"fixture",name:"app",defaultBranch:"main",gitRef,entries:Object.keys(files).map(path=>({path,type:"blob"})),contents:new Map(Object.entries(files)),sourceFilesFound:0,sourceFilesRead:0,partial});
const rules = (files:Record<string,string>, id:string, partial=false) => auditHosting(snapshot(files,partial)).findings.filter(f=>f.ruleId===id);
const render = (service:string) => `services:\n  - type: web\n    name: site\n${service}`;

test("Fly and Render share host recognition with archive selection and exclude fixtures",()=>{
 for(const file of ["fly.toml","render.yaml","render.yml"]) assert.equal(HOST_CONFIG_FILE.test(file),true);
 assert.deepEqual(hostingPlatforms(["fly.toml","render.yaml","Dockerfile.production"]),["Fly.io","Render","Docker"]);
 assert.deepEqual(hostingPlatforms(["tests/fixtures/fly.toml","vendor/render.yml"]),[]);
});
test("Fly syntax and explicit port range are evidence backed",()=>{
 assert.equal(rules({"fly.toml":"[bad"},"fly-config-syntax")[0].status,"red");
 assert.equal(rules({"fly.toml":"[http_service]\ninternal_port=70000"},"fly-internal-port")[0].line,2);
 assert.equal(rules({"fly.toml":"[[services]]\ninternal_port=8080\n[[services]]\ninternal_port=70000"},"fly-internal-port")[0].line,4);
 for(const port of [1,8080,65535]) assert.equal(rules({"fly.toml":`[http_service]\ninternal_port=${port}`},"fly-internal-port").length,0);
 assert.equal(rules({"fly.toml":"# internal_port=70000\n[http_service]"},"fly-internal-port").length,0);
});
test("Fly process groups and volume targets are checked without inventing missing default processes",()=>{
 const bad='[processes]\nweb="node server.js"\n[http_service]\nprocesses=["worker"]\n[mounts]\nsource="data"\ndestination="/"';
 assert.equal(rules({"fly.toml":bad},"fly-process-reference").length,1);
 assert.equal(rules({"fly.toml":bad},"fly-volume-destination").length,1);
 assert.equal(rules({"fly.toml":bad.replace('["worker"]','["web"]').replace('destination="/"','destination="/data"')},"fly-process-reference").length,0);
 assert.equal(rules({"fly.toml":'[http_service]\nprocesses=["app"]'},"fly-process-reference").length,0);
});
test("Fly Dockerfile checks honor image/buildpack selection and remote URLs",()=>{
 const file='[build]\ndockerfile="Dockerfile.production"';
 assert.equal(rules({"fly.toml":file},"fly-dockerfile-path").length,1);
 assert.equal(rules({"fly.toml":file,"Dockerfile.production":"FROM node:24"},"fly-dockerfile-path").length,0);
 for(const extra of ['image="registry/app"','builder="paketobuildpacks/builder"']) assert.equal(rules({"fly.toml":file+'\n'+extra},"fly-dockerfile-path").length,0);
 assert.equal(rules({"fly.toml":'[build]\ndockerfile="https://example.com/Dockerfile"'},"fly-dockerfile-path").length,0);
});
test("Render YAML syntax and duplicate keys are checked; source values never appear in errors",()=>{
 assert.equal(rules({"render.yaml":"services: ["},"render-config-syntax")[0].status,"red");
 assert.equal(rules({"render.yaml":"services: []\nservices: []\nsecret: NEVER_PRINT_THIS_VALUE"},"render-config-syntax")[0].status,"red");
 assert.doesNotMatch(JSON.stringify(auditHosting(snapshot({"render.yaml":"services: [\nNEVER_PRINT_THIS_VALUE"}))),/NEVER_PRINT_THIS_VALUE/);
 assert.equal(rules({"render.yaml":"services: [","render.yml":"services: []"},"render-config-syntax")[0].status,"yellow");
});
test("Render rootDir paths use the service root and partial trees do not assert missing directories",()=>{
 const source=render('    runtime: node\n    rootDir: apps/site\n');
 assert.equal(rules({"render.yaml":source},"render-root-directory")[0].status,"red");
 assert.equal(rules({"render.yaml":source,"apps/site/package.json":"{}"},"render-root-directory").length,0);
 assert.equal(rules({"render.yaml":source},"render-root-directory",true).length,0);
 assert.equal(rules({"render.yaml":render('    rootDir: .\n')},"render-root-directory").length,0);
});
test("Render external repos and explicit unscanned branches do not use the wrong source tree",()=>{
 for(const setting of ['repo: https://github.com/other/app','branch: release']) assert.equal(rules({"render.yaml":render(`    rootDir: missing\n    ${setting}\n`)},"render-root-directory").length,0);
 const findings=auditHosting(snapshot({"render.yaml":render('    rootDir: missing\n    branch: release\n')},false,"release")).findings;
 assert.ok(findings.some(f=>f.ruleId==="render-root-directory"));
});
test("Render Dockerfile and healthcheck paths produce specific locations and avoid external image assumptions",()=>{
 const source=render('    runtime: docker\n    rootDir: backend\n    dockerfilePath: Dockerfile\n    healthCheckPath: health\n');
 const files={"render.yaml":source,"backend/main.py":"print('data only')"};
 assert.equal(rules(files,"render-dockerfile-path").length,1);assert.equal(rules(files,"render-healthcheck-path")[0].line,7);
 assert.equal(rules({...files,"backend/Dockerfile":"FROM python:3.13"},"render-dockerfile-path").length,0);
 assert.equal(rules({"render.yaml":source.replace('runtime: docker','runtime: image')},"render-dockerfile-path").length,0);
 assert.equal(rules({"render.yaml":source.replace('healthCheckPath: health','healthCheckPath: /health')},"render-healthcheck-path").length,0);
});
test("Render scripts use nested package manifests and do not treat package-manager builtins as scripts",()=>{
 const source=render('    runtime: node\n    rootDir: apps/site\n    buildCommand: pnpm run generate\n');
 const files={"render.yaml":source,"package.json":'{"scripts":{"generate":"ok"}}',"apps/site/package.json":'{"scripts":{"build":"ok"}}'};
 assert.equal(rules(files,"render-missing-script").length,1);
 assert.equal(rules({...files,"apps/site/package.json":'{"scripts":{"generate":"ok"}}'},"render-missing-script").length,0);
 for(const command of ['pnpm install','npm ci','yarn install','npm start','npm run generate && npm run build']) assert.equal(rules({...files,"render.yaml":source.replace('pnpm run generate',command)},"render-missing-script").length,0);
});
test("Render development commands, static file outputs and cron declarations remain conservative",()=>{
 assert.equal(rules({"render.yaml":render('    runtime: node\n    startCommand: npm run dev\n')},"render-development-start")[0].status,"yellow");
 assert.equal(rules({"render.yaml":render('    runtime: node\n    startCommand: node server.js\n')},"render-development-start").length,0);
 const source=render('    runtime: static\n    staticPublishPath: dist\n');
 assert.equal(rules({"render.yaml":source},"render-static-publish-file").length,0);
 assert.equal(rules({"render.yaml":source,"dist":"not a directory"},"render-static-publish-file").length,1);
 assert.equal(rules({"render.yaml":render('    runtime: node\n').replace('type: web','type: cron')},"render-cron-schedule")[0].status,"yellow");
});
test("Render environments and bounded YAML aliases are understood without executing tags",()=>{
 const source='projects:\n  - name: project\n    environments:\n      - name: production\n        services:\n          - type: web\n            name: app\n            runtime: node\n            healthCheckPath: broken\n';
 assert.equal(rules({"render.yaml":source},"render-healthcheck-path")[0].line,9);
 const alias='defaults: &settings\n  type: web\n  name: site\n  runtime: node\nservices:\n  - <<: *settings\n    healthCheckPath: /health\n';
 assert.equal(rules({"render.yaml":alias},"render-config-syntax").length,0);
 const dangerous='x: !js/function "() => { globalThis.EXECUTION_TRAP = true }"\nservices: []';
 assert.ok(auditHosting(snapshot({"render.yaml":dangerous})).limitations.some(l=>l.includes("manual review")));
 const bomb='a: &a [a,a,a,a,a,a,a,a,a,a]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nservices: *c';
 assert.ok(auditHosting(snapshot({"render.yaml":bomb})).limitations.some(l=>l.includes("alias budget")));
});
test("sensitive Docker build variables are review findings without recording secret values",()=>{
 const findings=rules({Dockerfile:'FROM node:24\nARG STRIPE_SECRET_KEY\nENV DATABASE_PASSWORD=NEVER_PRINT_THIS_VALUE\n# ENV DATABASE_PASSWORD=example\nENV PUBLIC_URL=https://example.com\nENV API_TOKEN=placeholder'},"docker-sensitive-build-variable");
 assert.equal(findings.length,2);assert.ok(findings.every(f=>f.status==="yellow"));assert.doesNotMatch(JSON.stringify(findings),/NEVER_PRINT_THIS_VALUE/);
 assert.equal(rules({Dockerfile:'FROM node:24\nRUN --mount=type=secret,id=token cat /run/secrets/token'},"docker-sensitive-build-variable").length,0);
});
test("Render and Fly findings reach existing reports, JSON and Launch Readiness with compatible categories",()=>{
 const r=analyzeSnapshot(snapshot({"render.yaml":render('    runtime: node\n    healthCheckPath: health\n'),"fly.toml":"[http_service]\ninternal_port=70000","package.json":'{"scripts":{"build":"vite build"},"dependencies":{"vite":"7"}}'}));
 assert.ok(r.checks.flatMap(c=>c.findings??[]).some(f=>f.ruleId==="render-healthcheck-path"));
 const json=reportJson({id:"fixture-report",repo_url:"https://github.com/fixture/app",created_at:r.checkedAt,results:r});assert.ok(json.hosting?.platforms.includes("Fly.io"));assert.ok(json.launchReadiness.notVerified.some(l=>l.includes("Fly CLI")));
 assert.doesNotMatch(r.checks.find(c=>c.id==="build-config")!.fix,/Vercel/);
 const excluded=analyzeSnapshot(snapshot({"fly.toml":"[bad"}),{checks:["env"]});assert.equal(excluded.hosting?.findings.length,0);
});

test("the pinned official Render Express example avoids false script and source-path errors",async()=>{
 const {readFile}=await import("node:fs/promises");
 const example=JSON.parse(await readFile(new URL("./fixtures/hosting/render-official.json",import.meta.url),"utf8"));
 assert.equal(example.commit,"039c34770852fb07cef7f9f0f8534c5de408b207");
 const result=auditHosting(snapshot(example.files));assert.deepEqual(result.findings.filter(f=>f.ruleId?.startsWith("render-")),[]);
 const broken={...example.files,"render.yaml":example.files["render.yaml"].replace("    startCommand:","    healthCheckPath: missing-slash\n    startCommand:")};
 assert.equal(rules(broken,"render-healthcheck-path").length,1);
});
