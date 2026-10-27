import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { checkProductionSafety } from "../src/lib/production-safety";
import { reportJson } from "../src/lib/report-json";
import { freeFixInstructions } from "../src/lib/fix-instructions";

const prefix = `import Stripe from 'stripe'; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n`;
const verified = `const event = stripe.webhooks.constructEvent(await req.text(), 'sig', 'secret');`;
const append = `if(event.type === 'checkout.session.completed'){const session=event.data.object; await db.orders.create({data:{email:session.customer_email}});}`;
function snapshot(source: string, extra: Record<string,string> = {}): RepositorySnapshot {
  const files={"package.json":'{"dependencies":{"next":"16.4.2","stripe":"22.6.0"}}',"app/api/webhook/route.ts":source,...extra};
  return {owner:"fixture",name:"shop",defaultBranch:"main",contents:new Map(Object.entries(files)),entries:Object.keys(files).map(path=>({path,type:"blob"})),sourceFilesFound:1,sourceFilesRead:1,partial:false};
}
function risks(body: string) { return checkProductionSafety(snapshot(prefix+`export async function POST(req: Request){${verified}${body}}`)).findings?.filter(f=>f.ruleId?.startsWith("stripe-event-replay")||f.ruleId==="stripe-memory-deduplication")??[]; }

test("unkeyed fulfillment append is review with file/line evidence, not an asserted duplicate charge",()=>{
  const findings=risks("\n"+append);
  assert.equal(findings.length,1);assert.equal(findings[0].status,"yellow");assert.equal(findings[0].file,"app/api/webhook/route.ts");assert.equal(findings[0].line,3);
  assert.match(findings[0].fix,/atomic|transaction/);assert.match(findings[0].fix,/concurrent/);assert.match(findings[0].fix,/retries/);
  assert.equal(findings[0].repairable,undefined);
});
test("event IDs, business object IDs and delegated whole events are not declared missing protection",()=>{
  for(const body of [
    `await claimEvent(event.id);${append}`,
    `await claimEvent(event['id']);${append}`,
    `await handleBillingEvent(event);${append}`,
    `if(event.type==='checkout.session.completed'){const session=event.data.object;await fulfillCheckout(session.id);}`,
    `if(event.type==='checkout.session.completed'){const session=event.data.object;await db.orders.create({data:{stripeId:session.id}});}`,
    `if(event.type==='checkout.session.completed')console.log('received');`,
  ]) assert.equal(risks(body).length,0,body);
});
test("module Set, local Map and aliased event IDs get process-memory review",()=>{
  for(const [store,body] of [
    ["const seen=new Set();",`if(seen.has(event.id))return;seen.add(event.id);${append}`],
    ["",`const seen=new Map();const id=event.id;if(seen.has(id))return;seen.set(id,true);${append}`],
    ["const seen=new Map();",`if(seen.get(event.id))return;seen.set(event.id,true);${append}`],
  ]){
    const c=checkProductionSafety(snapshot(prefix+store+`export async function POST(req:Request){${verified}${body}}`));
    assert.deepEqual(c.findings?.filter(f=>f.ruleId?.includes("deduplication")).map(f=>f.status),["yellow"]);
    assert.match(c.findings?.find(f=>f.ruleId==="stripe-memory-deduplication")?.fix??"",/restarts|serverless/);
  }
});
test("unrelated sets, shadowed cache names and custom Set classes do not impersonate memory deduplication",()=>{
  for(const source of [
    prefix+`const seen=new Set();export async function POST(req:Request){${verified}if(seen.has(event.id))return;seen.add(event.id);await durableClaim(event.id);}`,
    prefix+`const seen=new Set();export async function POST(req:Request){${verified}seen.has('unrelated');seen.add('unrelated');}`,
    prefix+`const seen=new Set();export async function POST(req:Request){${verified}const seen=await durableStore();if(seen.has(event.id))return;seen.add(event.id);}`,
    prefix+`class Set{has(id){return true}add(id){}}const seen=new Set();export async function POST(req:Request){${verified}if(seen.has(event.id))return;seen.add(event.id);}`,
  ])assert.ok(!checkProductionSafety(snapshot(source)).findings?.some(f=>f.ruleId==="stripe-memory-deduplication"));
});
test("comments, strings, nested unrelated handlers and non-Stripe payloads do not create replay findings",()=>{
  assert.equal(risks(`// ${append}\nconst example=${JSON.stringify(append)};return new Response(example);`).length,0);
  assert.equal(risks(`function example(){${append}}return Response.json({ok:true});`).length,0);
  const plain=`export async function POST(req:Request){const event=await req.json();${append}}`;
  assert.ok(!checkProductionSafety(snapshot(plain)).findings?.some(f=>f.ruleId==="stripe-event-replay"));
});
test("imported singleton/factory clients and async verification keep the same evidence",()=>{
  for(const [client,verification] of [["import {stripe} from '@/lib/stripe';",verified],["import {stripeClient} from '@/lib/stripe';",verified.replace("stripe.webhooks.constructEvent", "stripeClient().webhooks.constructEventAsync")]]){
    const source=client+`export const POST=async(req:Request)=>{${verification}${append}}`;
    assert.ok(checkProductionSafety(snapshot(source)).findings?.some(f=>f.ruleId==="stripe-event-replay"));
  }
});
test("new findings flow through analyzer, JSON, Launch Readiness and copied fixes",()=>{
  const results=analyzeSnapshot(snapshot(prefix+`export async function POST(req:Request){${verified}${append}}`));
  const json=reportJson({id:"r",repo_url:"https://github.com/fixture/shop",created_at:results.checkedAt,results});
  const finding=json.launchReadiness.reviewBeforeLaunch.find(f=>f.ruleId==="stripe-event-replay");
  assert.ok(finding);assert.equal(finding.repair,null);assert.match(finding.href,/#check-production-safety$/);
  assert.ok(!json.launchReadiness.criticalBlockers.some(f=>f.ruleId==="stripe-event-replay"));
  assert.match(json.launchReadiness.notVerified.join(" "),/transactions were not verified/);
  assert.match(freeFixInstructions({id:"r",repo_url:"https://github.com/fixture/shop",created_at:results.checkedAt,results}),/Duplicate-delivery protection needs review/);
});
test("DeployDoctor's existing delegated billing webhook is not declared to lack idempotency",()=>{
  const source=readFileSync(new URL("../src/app/api/stripe/webhook/route.ts",import.meta.url),"utf8");
  assert.ok(!checkProductionSafety(snapshot(source)).findings?.some(f=>f.ruleId==="stripe-event-replay"));
});
