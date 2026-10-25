import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { checkProductionSafety, PRODUCTION_RULES } from "../src/lib/production-safety";
import { launchReadiness } from "../src/lib/launch-readiness";
import { reportJson } from "../src/lib/report-json";

function snapshot(files: Record<string, string>, partial = false): RepositorySnapshot {
  files = { "package.json": JSON.stringify({ dependencies: { next: "16.4.2" } }), ...files };
  return { owner: "fixture", name: "launch", defaultBranch: "main", entries: Object.keys(files).map(path => ({path, type: "blob"})), contents: new Map(Object.entries(files)), sourceFilesFound: Object.keys(files).length, sourceFilesRead: Object.keys(files).length, partial };
}
const stripe = `import Stripe from 'stripe'; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n`;
const fixtures = [
  {rule:"stripe-raw-body", file:"app/api/webhook/route.ts", bad:stripe+`export async function POST(req: Request) { const body = await req.json(); return stripe.webhooks.constructEvent(body, 'sig', 'secret'); }`, good:stripe+`export async function POST(req: Request) { const body = await req.text(); return stripe.webhooks.constructEvent(body, 'sig', 'secret'); }`},
  {rule:"stripe-event-verification", file:"app/api/stripe/webhook/route.ts", bad:stripe+`export async function POST(req: Request) { const event = await req.json(); return Response.json({type: event.type}); }`, good:stripe+`export async function POST(req: Request) { const event = await verifyStripeWebhook(req); return Response.json({type: event.type}); }`},
  {rule:"stripe-pages-body-parser", file:"pages/api/stripe-webhook.ts", bad:stripe+`export default async function handler(req, res) { const event = stripe.webhooks.constructEvent(req.body, 'sig','secret'); res.json(event); }`, good:stripe+`export const config = { api: { bodyParser: false } }; export default async function handler(req, res) { const event = stripe.webhooks.constructEvent(await buffer(req), 'sig','secret'); res.json(event); }`},
  {rule:"checkout-local-redirect", file:"app/api/checkout/route.ts", bad:stripe+`export async function POST(){ return stripe.checkout.sessions.create({success_url:'http://localhost:3000/success', cancel_url:'https://shop.example/cancel'}); }`, good:stripe+`export async function POST(){ return stripe.checkout.sessions.create({success_url:'https://shop.example/success', cancel_url:process.env.CANCEL_URL}); }`},
  {rule:"next-client-boundary", file:"app/page.tsx", bad:`'use client'; import { cookies } from 'next/headers'; export default function Page(){return null}`, good:`'use client'; import type { ReadonlyHeaders } from 'next/headers'; export default function Page(){return null}`},
  {rule:"next-runtime-value", file:"src/app/api/orders/route.ts", bad:`export const runtime = 'node'; export function GET(){return Response.json({ok:true})}`, good:`export const runtime = 'nodejs'; export function GET(){return Response.json({ok:true})}`},
  {rule:"personalized-static-cache", file:"app/api/account/route.ts", bad:`export const dynamic = 'force-static'; export function GET(req: Request){ return Response.json({token: req.headers.get('authorization')}); }`, good:`export const dynamic = 'force-dynamic'; export function GET(req: Request){ return Response.json({ok: !!req.headers.get('authorization')}, { headers: { 'Cache-Control': 'private, no-store' } }); }`},
  {rule:"tls-verification-disabled", file:"src/lib/payments.ts", bad:`import https from 'node:https'; const agent = new https.Agent({ rejectUnauthorized: false });`, good:`import {Agent} from 'node:https'; const agent = new Agent({ rejectUnauthorized: true });`},
];
for (const fixture of fixtures) {
  test(`production rule ${fixture.rule}: positive evidence and safe negative`, () => {
    const bad = checkProductionSafety(snapshot({[fixture.file]:fixture.bad}));
    const finding = bad.findings?.find(f => f.ruleId === fixture.rule);
    assert.ok(finding, fixture.rule);
    assert.equal(finding.file, fixture.file); assert.ok(finding.line >= 1); assert.ok(finding.fix.length > 25);
    assert.ok(!checkProductionSafety(snapshot({[fixture.file]:fixture.good})).findings?.some(f => f.ruleId === fixture.rule));
  });
}
test("all advertised production rules have positive/negative fixtures", () => assert.deepEqual(fixtures.map(f=>f.rule).sort(), [...PRODUCTION_RULES].sort()));
test("comments, prose strings, test fixtures and type-only imports do not trigger rules", () => {
  const source = `// export const runtime = 'node';\nconst prose = ${JSON.stringify(fixtures.map(f=>f.bad).join("\n"))}; export function GET(){return new Response(prose)}`;
  const result = checkProductionSafety(snapshot({"app/api/docs/route.ts":source, "tests/fixture.ts":fixtures[0].bad, "src/payments.d.ts":fixtures[0].bad}));
  assert.equal(result.findings?.length,0);
});
test("client metadata is rejected while server metadata and type-only names are allowed", () => {
  for (const code of [`'use client'; export const metadata = {title:'Shop'};`, `'use client'; export function generateMetadata(){return {title:'Shop'}}`]) assert.equal(checkProductionSafety(snapshot({"app/page.tsx":code})).status,"red");
  assert.equal(checkProductionSafety(snapshot({"app/page.tsx":`export const metadata = {title:'Shop'};`})).findings?.length,0);
});
test("literal evidence is reported without leaking a URL query or signing secret", () => {
  const source = fixtures[3].bad.replace("localhost:3000/success", "localhost:3000/success?token=never-copy-this");
  assert.doesNotMatch(JSON.stringify(checkProductionSafety(snapshot({[fixtures[3].file]:source}))),/never-copy-this/);
});
test("unread files and ignored categories never become executed production rules", () => {
  const s = snapshot({"package.json":'{"dependencies":{"next":"16.4.2"}}'},true);
  s.entries.push({path:"app/api/webhook/route.ts",type:"blob"});
  const c = checkProductionSafety(s); assert.equal(c.status,"yellow");assert.equal(c.coverageOnly,true);assert.deepEqual(c.evaluatedRules,[]);
  assert.ok(!analyzeSnapshot(s,{checks:["env"]}).checks.some(c=>c.id==="production-safety"));
});
test("launch JSON is additive, separates mixed severity, coverage and incomplete manual work", () => {
  const r = analyzeSnapshot(snapshot({"package.json":'{"dependencies":{"next":"16.4.2"}}', ...Object.fromEntries(fixtures.map(f=>[f.file,f.bad]))}));
  r.repository.commitSha = "a".repeat(40);
  const stored = {id:"00000000-0000-4000-8000-000000000000",repo_url:"https://github.com/fixture/launch",created_at:r.checkedAt,results:r};
  const json = reportJson(stored);
  assert.equal(json.id,stored.id);assert.equal(json.overall,r.overall);assert.equal(json.checks.length,r.checks.length);assert.equal(json.commitSha,r.repository.commitSha);
  assert.ok(json.launchReadiness.criticalBlockers.some(f=>f.ruleId==="next-runtime-value"));
  assert.ok(json.launchReadiness.reviewBeforeLaunch.some(f=>f.ruleId==="checkout-local-redirect"));
  assert.ok(!json.launchReadiness.criticalBlockers.some(f=>f.ruleId==="checkout-local-redirect"));
  assert.ok(json.launchReadiness.checklist.filter(i=>i.kind==="manual").every(i=>i.completed===false));
  assert.match(json.launchReadiness.notVerified.join(" "),/checkout were not tested/);
});
test("old and partial reports never claim that new checks or checkout were tested", () => {
  const r = analyzeSnapshot(snapshot({"package.json":'{"dependencies":{"next":"16.4.2"}}'}));
  r.checks=[];r.scan.partial=true;
  const launch = launchReadiness(r,"old-report");assert.equal(launch.status,"incomplete");assert.equal(launch.checksPerformed.length,0);assert.match(launch.notVerified.join(" "),/Partial scan/);
  r.scan.partial=false;assert.equal(launchReadiness(r,"old-report").status,"incomplete");
});

 test("Next-specific findings require an actual Next dependency; client utility metadata is allowed", () => {
   assert.equal(checkProductionSafety(snapshot({"package.json":'{"dependencies":{"react":"19"}}',"src/widget.tsx": "'use client'; export const metadata = {};", "app/api/x/route.ts":"export const runtime = 'node';"})).findings?.length,0);
   assert.equal(checkProductionSafety(snapshot({"src/widget.tsx":"'use client'; export const metadata = {};"})).findings?.length,0);
 });
test("production-only launch summary handles coverage and applicable category exclusions honestly", () => {
  const r = analyzeSnapshot(snapshot({"app/page.tsx":"export default function Page(){return null}","package.json":'{"dependencies":{"next":"16.4.2"},"scripts":{"build":"next build"},"engines":{"node":"24.x"}}',"package-lock.json":'{"lockfileVersion":3,"packages":{"":{"dependencies":{"next":"16.4.2"}}}}'}));
  // Use a passing check to isolate launch presentation from other build rules.
  r.checks=[{id:"production-safety",title:"Production",status:"green",explanation:"No matches",fix:"Review",evidence:[],findings:[],evaluatedRules:[]}];
  r.scope={scanned:["next","vercel","env"],ignored:["prisma","supabase"]};
  assert.equal(launchReadiness(r,"r").status,"checks-passed", "unused stacks are not missing coverage");
  r.scope={scanned:["vercel"],ignored:["next","env","supabase","prisma"]};
  assert.equal(launchReadiness(r,"r").status,"incomplete");
  r.checks=[{id:"production-safety",title:"Production",status:"yellow",explanation:"Incomplete",fix:"Review",evidence:[],findings:[],coverageOnly:true}];
  const gap=launchReadiness(r,"r");assert.equal(gap.reviewBeforeLaunch.length,0);assert.equal(gap.status,"incomplete");
});
test("invalid syntax is incomplete coverage, never a fabricated clean safety check", () => {
  const c=checkProductionSafety(snapshot({"app/api/webhook/route.ts":"export async function POST( {"}));
  assert.equal(c.coverageOnly,true);assert.equal(c.status,"yellow");assert.equal(c.findings?.length,0);
});
test("arrow route handlers and directive prologues retain production evidence", () => {
  const result=checkProductionSafety(snapshot({"app/api/webhook/route.ts":stripe+"export const POST = async (request: Request) => { const payload=await request.json(); return stripe.webhooks.constructEvent(payload,'sig','secret') }", "app/layout.tsx":"'use strict'; 'use client'; export const metadata={title:'Shop'};"}));
  assert.ok(result.findings?.some(f=>f.ruleId==="stripe-raw-body"));assert.ok(result.findings?.some(f=>f.ruleId==="next-client-boundary"));
});
