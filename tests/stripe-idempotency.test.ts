import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { checkProductionSafety } from "../src/lib/production-safety";
import { reportJson } from "../src/lib/report-json";
import { freeFixInstructions } from "../src/lib/fix-instructions";

const RULES = new Set(["stripe-event-replay", "stripe-idempotency-race", "stripe-idempotency-unestablished", "stripe-memory-deduplication"]);
const prefix = `import Stripe from "stripe";\nimport { prisma } from "@/lib/db";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n`;
const verified = `const event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature")!, "whsec");\nconst session = event.data.object as Stripe.Checkout.Session;\n`;
const schema = `
model ProcessedEvent {
  id        String   @id
  createdAt DateTime @default(now())
}
model WebhookLog {
  id      Int    @id @default(autoincrement())
  eventId String
}
model Order {
  id              String @id @default(cuid())
  stripeSessionId String @unique
  email           String
  status          String
}
model LooseOrder {
  id        String @id @default(cuid())
  sessionId String
  email     String
}
model EventClaim {
  id      Int    @id @default(autoincrement())
  eventId String
  kind    String
  @@unique([eventId, kind])
}
model Shipment {
  id        String @id @default(cuid())
  orderId   String
  eventType String
  @@unique([orderId, eventType])
}`;

function snapshot(files: Record<string, string>, unread: string[] = []): RepositorySnapshot {
  const all = { "package.json": JSON.stringify({ dependencies: { next: "16.4.2", stripe: "22.6.0", "@prisma/client": "6.0.0" } }), "prisma/schema.prisma": schema, ...files };
  const paths = [...Object.keys(all), ...unread];
  return { owner: "fixture", name: "shop", defaultBranch: "main", contents: new Map(Object.entries(all)), entries: paths.map(p => ({ path: p, type: "blob" as const })),
    sourceFilesFound: paths.length, sourceFilesRead: Object.keys(all).length, partial: unread.length > 0 };
}
const risks = (body: string, files: Record<string, string> = {}, unread: string[] = []) =>
  checkProductionSafety(snapshot({ "app/api/webhook/route.ts": `${prefix}export async function POST(req: Request) {\n${verified}${body}\nreturn Response.json({ received: true });\n}`, ...files }, unread))
    .findings?.filter(f => RULES.has(f.ruleId ?? "")) ?? [];
const looseOrder = `await prisma.looseOrder.create({ data: { email: session.customer_email! } });`;

test("a durable event claim with a unique key before fulfillment is accepted", () => {
  assert.deepEqual(risks(`await prisma.processedEvent.create({ data: { id: event.id } });\n${looseOrder}`), []);
  // A composite unique key counts when every one of its columns is written.
  assert.deepEqual(risks(`await prisma.eventClaim.create({ data: { eventId: event.id, kind: "checkout" } });\n${looseOrder}`), []);
});

test("recording an event is not reported as protection: non-unique ledgers, late ledgers and swallowed errors", () => {
  const [log] = risks(`await prisma.webhookLog.create({ data: { eventId: event.id } });\n${looseOrder}`);
  assert.equal(log.ruleId, "stripe-idempotency-unestablished");
  assert.equal(log.status, "yellow");
  assert.match(log.problem, /recorded in webhookLog/);
  assert.match(log.problem, /no unique constraint or primary key covering eventid is visible in prisma\/schema\.prisma/);
  assert.match(log.problem, /not a confirmed vulnerability/);
  const [late] = risks(`${looseOrder}\nawait prisma.processedEvent.create({ data: { id: event.id } });`);
  assert.match(late.problem, /only after the write at app\/api\/webhook\/route\.ts:7/);
  const [swallowed] = risks(`try { await prisma.processedEvent.create({ data: { id: event.id } }); } catch (error) { console.warn("duplicate", error); }\n${looseOrder}`);
  assert.match(swallowed.problem, /try\/catch that continues/);
  const [partialKey] = risks(`await prisma.eventClaim.create({ data: { eventId: event.id } });\n${looseOrder}`);
  assert.match(partialKey.problem, /no unique constraint/, "a composite key with an unwritten column does not cover the write");
});

test("a shared transaction with a unique event key protects fulfillment written before the claim", () => {
  assert.deepEqual(risks(`await prisma.$transaction(async (tx) => {\n${looseOrder.replace("prisma.", "tx.")}\nawait tx.processedEvent.create({ data: { id: event.id } });\n});`), []);
  // Fulfillment committed in its own transaction, the claim afterwards in another: parallel deliveries both fulfill.
  const [outside] = risks(`await prisma.$transaction(async (tx) => {\n${looseOrder.replace("prisma.", "tx.")}\n});\nawait prisma.processedEvent.create({ data: { id: event.id } });`);
  assert.equal(outside.ruleId, "stripe-idempotency-unestablished");
  assert.match(outside.problem, /outside a shared transaction/);
});

test("check-then-insert is a race between parallel deliveries, even with a unique key on the late record", () => {
  const body = `const seen = await prisma.processedEvent.findUnique({ where: { id: event.id } });\nif (seen) return Response.json({ duplicate: true });\n${looseOrder}\nawait prisma.processedEvent.create({ data: { id: event.id } });`;
  const [race] = risks(body);
  assert.equal(race.ruleId, "stripe-idempotency-race");
  assert.equal(race.line, 7);
  assert.match(race.problem, /arrive at the same time can both pass the check/);
  assert.match(race.problem, /unique key stops the second processedEvent row, but the write at app\/api\/webhook\/route\.ts:9 runs before it/);
  assert.match(race.fix, /two deliveries at the same time/);
  const inverted = risks(`const seen = await prisma.processedEvent.findUnique({ where: { id: event.id } });\nif (!seen) {\n${looseOrder}\nawait prisma.processedEvent.create({ data: { id: event.id } });\n}`);
  assert.equal(inverted[0]?.ruleId, "stripe-idempotency-race", "if (!seen) { write } is the same pattern");
  // The read only saves work when the unique claim itself still runs first.
  assert.deepEqual(risks(`const seen = await prisma.processedEvent.findUnique({ where: { id: event.id } });\nif (seen) return Response.json({ duplicate: true });\nawait prisma.processedEvent.create({ data: { id: event.id } });\n${looseOrder}`), []);
});

test("business-object keys protect the order or payment itself, and are checked against the schema", () => {
  assert.deepEqual(risks(`await prisma.order.upsert({ where: { stripeSessionId: session.id }, create: { stripeSessionId: session.id, email: session.customer_email! }, update: {} });`), []);
  assert.deepEqual(risks(`await prisma.order.create({ data: { stripeSessionId: session.id, email: session.customer_email! } });`), []);
  const [loose] = risks(`await prisma.looseOrder.create({ data: { sessionId: session.id, email: session.customer_email! } });`);
  assert.equal(loose.ruleId, "stripe-idempotency-unestablished");
  assert.match(loose.problem, /keyed by sessionid from the Stripe object, but no unique constraint/);
  const [composite] = risks(`await prisma.shipment.create({ data: { orderId: session.metadata!.orderId } });`);
  assert.match(composite.problem, /keyed by orderid/);
  assert.deepEqual(risks(`await prisma.shipment.create({ data: { orderId: session.metadata!.orderId, eventType: event.type } });`), [], "both columns of the composite key are written");
  const [unknown] = risks(`await prisma.invoice.create({ data: { stripeInvoiceId: session.invoice } });`);
  assert.match(unknown.problem, /invoice is not defined in the Prisma schema or Supabase migrations read/);
});

test("an atomic conditional update guards the writes after it", () => {
  const claim = `const { count } = await prisma.order.updateMany({ where: { id: session.metadata!.orderId, status: "pending" }, data: { status: "paid" } });\n`;
  assert.deepEqual(risks(`${claim}if (count === 0) return Response.json({ duplicate: true });\nawait prisma.looseOrder.create({ data: { sessionId: session.id, email: "x" } });`), []);
  const [unchecked] = risks(`${claim}await prisma.looseOrder.create({ data: { sessionId: session.id, email: "x" } });`);
  assert.equal(unchecked.ruleId, "stripe-idempotency-unestablished");
});

test("logged IDs and IDs handed to code that cannot be read are not protection", () => {
  const [logged] = risks(`console.log("processing", event.id);\n${looseOrder}`);
  assert.equal(logged.ruleId, "stripe-idempotency-unestablished");
  assert.match(logged.problem, /only logged at app\/api\/webhook\/route\.ts:7/);
  const [undefinedHelper] = risks(`await markProcessed(event.id);\n${looseOrder}`);
  assert.match(undefinedHelper.problem, /markProcessed is not defined in this file/);
  const external = checkProductionSafety(snapshot({ "app/api/webhook/route.ts": `import { markProcessed } from "@acme/billing";\n${prefix}export async function POST(req: Request) {\n${verified}await markProcessed(event.id);\n${looseOrder}\nreturn Response.json({ ok: true });\n}` })).findings!.find(f => RULES.has(f.ruleId!))!;
  assert.match(external.problem, /event\.id is passed to markProcessed .* it comes from the package @acme\/billing/);
  const whole = checkProductionSafety(snapshot({ "app/api/webhook/route.ts": `import { handleEvent } from "@acme/billing";\n${prefix}export async function POST(req: Request) {\n${verified}await handleEvent(event);\nreturn Response.json({ ok: true });\n}` })).findings!.find(f => RULES.has(f.ruleId!))!;
  assert.match(whole.problem, /the event is passed to handleEvent/);
});

test("imported helpers are followed: a real claim protects, a logging helper does not, an unread one is named", () => {
  const route = (call: string) => `import { claim } from "@/lib/events";\n${prefix}export async function POST(req: Request) {\n${verified}${call}\n${looseOrder}\nreturn Response.json({ ok: true });\n}`;
  const durable = `import { prisma } from "@/lib/db";\nexport async function claim(id: string) { await prisma.processedEvent.create({ data: { id } }); }\n`;
  assert.deepEqual(checkProductionSafety(snapshot({ "app/api/webhook/route.ts": route("await claim(event.id);"), "src/lib/events.ts": durable })).findings?.filter(f => RULES.has(f.ruleId!)), []);
  const logging = `export async function claim(id: string) { console.info("stripe event", id); }\n`;
  const [logged] = checkProductionSafety(snapshot({ "app/api/webhook/route.ts": route("await claim(event.id);"), "src/lib/events.ts": logging })).findings!.filter(f => RULES.has(f.ruleId!));
  assert.match(logged.problem, /only logged at src\/lib\/events\.ts:1/);
  const [unread] = checkProductionSafety(snapshot({ "app/api/webhook/route.ts": route("await claim(event.id);") }, ["src/lib/events.ts"])).findings!.filter(f => RULES.has(f.ruleId!));
  assert.match(unread.problem, /src\/lib\/events\.ts was not read in this scan/);
});

test("Supabase claims must be checked, because a unique violation returns an error instead of throwing", () => {
  const migration = { "supabase/migrations/001_events.sql": "create table public.stripe_events (id text primary key, created_at timestamptz default now());\ncreate table public.orders (id uuid primary key default gen_random_uuid(), email text);" };
  const supa = `import { createClient } from "@supabase/supabase-js";\nimport Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nconst supabase = createClient("url", "key");\nexport async function POST(req: Request) {\n${verified}`;
  const checked = `const { error } = await supabase.from("stripe_events").insert({ id: event.id });\nif (error) return Response.json({ duplicate: true });\nawait supabase.from("orders").insert({ email: session.customer_email });\n`;
  assert.deepEqual(checkProductionSafety(snapshot({ ...migration, "app/api/webhook/route.ts": `${supa}${checked}return Response.json({ ok: true });\n}` })).findings?.filter(f => RULES.has(f.ruleId!)), []);
  const [unchecked] = checkProductionSafety(snapshot({ ...migration, "app/api/webhook/route.ts": `${supa}await supabase.from("stripe_events").insert({ id: event.id });\nawait supabase.from("orders").insert({ email: session.customer_email });\nreturn Response.json({ ok: true });\n}` })).findings!.filter(f => RULES.has(f.ruleId!));
  assert.match(unchecked.problem, /does not throw on a conflict and its result is not checked/);
});

test("rpc calls are followed into SQL functions in the migrations, including plpgsql guards and races", () => {
  const route = `import Stripe from "stripe";\nimport { rpc } from "@/lib/db";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nexport async function POST(req: Request) {\n${verified}await rpc("fulfill_checkout", { p_event_id: event.id, p_email: session.customer_email });\nreturn Response.json({ ok: true });\n}`;
  const fn = (body: string, events = "id text primary key") => ({ "supabase/migrations/002_fulfill.sql": `-- insert into stripe_events (id) values (p_event_id); is only a comment here\ncreate table public.stripe_events (${events});\ncreate table public.orders (id bigserial primary key, email text);\ncreate or replace function public.fulfill_checkout(p_event_id text, p_email text)\nreturns void language plpgsql as $$\nbegin\n${body}\nend $$;`, "app/api/webhook/route.ts": route });
  const check = (files: Record<string, string>) => checkProductionSafety(snapshot(files)).findings?.filter(f => RULES.has(f.ruleId!)) ?? [];
  assert.deepEqual(check(fn("  insert into public.stripe_events (id) values (p_event_id) on conflict do nothing;\n  if not found then return; end if;\n  insert into public.orders (email) values (p_email);")), []);
  const [unchecked] = check(fn("  insert into public.stripe_events (id) values (p_event_id) on conflict do nothing;\n  insert into public.orders (email) values (p_email);"));
  assert.equal(unchecked.file, "supabase/migrations/002_fulfill.sql");
  assert.equal(unchecked.line, 7);
  assert.match(unchecked.problem, /ON CONFLICT DO NOTHING and its result is not checked/);
  const lateClaim = "  if exists (select 1 from public.stripe_events where id = p_event_id) then return; end if;\n  insert into public.orders (email) values (p_email);\n  insert into public.stripe_events (id) values (p_event_id);";
  // One function is one transaction: a second delivery fails on the primary key and rolls back its order insert.
  assert.deepEqual(check(fn(lateClaim)), []);
  const [race] = check(fn(lateClaim, "id text, created_at timestamptz"));
  assert.equal(race.ruleId, "stripe-idempotency-race");
  assert.equal(race.line, 7);
  assert.match(race.problem, /stripe_events \(in database function fulfill_checkout\) is checked by id/);
  const [missing] = check({ "app/api/webhook/route.ts": route });
  assert.match(missing.problem, /database function fulfill_checkout is not defined in the Supabase migrations read/);
});

test("a Redis SET NX claim counts when its result stops the handler", () => {
  const body = (claim: string) => `const redis = new Redis();\n${claim}\n${looseOrder}`;
  assert.deepEqual(risks(body(`const fresh = await redis.set(\`stripe:\${event.id}\`, "1", { nx: true, ex: 86400 });\nif (!fresh) return Response.json({ duplicate: true });`)), []);
  const [unchecked] = risks(body(`await redis.set(\`stripe:\${event.id}\`, "1", "EX", 86400, "NX");`));
  assert.equal(unchecked.ruleId, "stripe-idempotency-unestablished");
});

test("comments and strings that mention claims are not protection", () => {
  const body = `// await prisma.processedEvent.create({ data: { id: event.id } });\nconst note = "await prisma.processedEvent.create({ data: { id: event.id } })";\n${looseOrder}`;
  const [finding] = risks(body);
  assert.equal(finding.ruleId, "stripe-event-replay");
  assert.equal(risks(`/* ${looseOrder} */\nconst example = ${JSON.stringify(looseOrder)};`).length, 0, "a commented write is not fulfillment");
});

test("review findings reach Launch Readiness and copied fixes as review items, never as patches", () => {
  const files = { "app/api/webhook/route.ts": `${prefix}export async function POST(req: Request) {\n${verified}console.log(event.id);\n${looseOrder}\nreturn Response.json({ ok: true });\n}` };
  const results = analyzeSnapshot(snapshot(files));
  const report = { id: "r", repo_url: "https://github.com/fixture/shop", created_at: results.checkedAt, results };
  const json = reportJson(report);
  const item = json.launchReadiness.reviewBeforeLaunch.find(f => f.ruleId === "stripe-idempotency-unestablished");
  assert.ok(item);
  assert.equal(item.repair, null);
  assert.ok(!json.launchReadiness.criticalBlockers.some(f => f.ruleId?.startsWith("stripe-idempotency")));
  assert.match(freeFixInstructions(report), /Duplicate-delivery protection could not be established/);
  assert.ok(results.checks.find(c => c.id === "production-safety")!.evaluatedRules!.includes("stripe-idempotency-race"));
});

/** DeployDoctor's own billing webhook: route → handleBillingEvent → rpc("apply_billing_event") → plpgsql claim on stripe_events. */
function repoSnapshot(skip: (file: string) => boolean = () => false): RepositorySnapshot {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(path.join(root, dir))) { const rel = dir ? `${dir}/${name}` : name; if (statSync(path.join(root, rel)).isDirectory()) walk(rel); else files.push(rel); } };
  walk("src"); walk("supabase/migrations");
  files.push("package.json", "tsconfig.json");
  const read = files.filter(f => !skip(f));
  return { owner: "jonjys", name: "deploydoctor", defaultBranch: "master", contents: new Map(read.map(f => [f, readFileSync(path.join(root, f), "utf8")])),
    entries: files.map(p => ({ path: p, type: "blob" as const })), sourceFilesFound: files.length, sourceFilesRead: read.length, partial: read.length < files.length };
}

test("DeployDoctor's own webhook is followed through its helper into the SQL function claim", () => {
  const own = (snapshot: RepositorySnapshot) => checkProductionSafety(snapshot).findings?.filter(f => RULES.has(f.ruleId!)) ?? [];
  assert.deepEqual(own(repoSnapshot()), []);
  const [unread] = own(repoSnapshot(file => file.startsWith("supabase/migrations/")));
  assert.equal(unread.ruleId, "stripe-idempotency-unestablished");
  assert.equal(unread.file, "src/lib/billing-events.ts");
  assert.match(unread.problem, /apply_billing_event is not defined in the Supabase migrations read, and \d+ schema or migration files were not read in this scan/);
});

test("setting a value twice is idempotent, adding to it twice is not", () => {
  const user = `model User {\n  id      String @id\n  plan    String\n  credits Int\n}`;
  const run = (body: string) => checkProductionSafety(snapshot({ "prisma/schema.prisma": schema + "\n" + user, "app/api/webhook/route.ts": `${prefix}export async function POST(req: Request) {\n${verified}${body}\nreturn Response.json({ ok: true });\n}` })).findings?.filter(f => RULES.has(f.ruleId!)) ?? [];
  assert.deepEqual(run(`await prisma.user.update({ where: { id: session.metadata!.userId }, data: { plan: "pro" } });`), []);
  const [increment] = run(`await prisma.user.update({ where: { id: session.metadata!.userId }, data: { credits: { increment: 100 } } });`);
  assert.equal(increment.ruleId, "stripe-idempotency-unestablished");
  assert.match(increment.problem, /adds to the current value/);
  const [upsert] = run(`await prisma.user.upsert({ where: { id: session.metadata!.userId }, create: { id: session.metadata!.userId, plan: "pro", credits: 100 }, update: { credits: { increment: 100 } } });`);
  assert.match(upsert.problem, /adds to the current value/);
  assert.deepEqual(run(`await prisma.processedEvent.create({ data: { id: event.id } });\nawait prisma.user.update({ where: { id: session.metadata!.userId }, data: { credits: { increment: 100 } } });`), [], "a unique event claim before the increment stops the duplicate");
});

test("Stripe API calls: setting state is idempotent, creating is not unless an idempotency key ties it to the event", () => {
  assert.deepEqual(risks(`await stripe.customers.update(session.customer as string, { metadata: { synced: "yes" } });`), []);
  const [refund] = risks(`await stripe.refunds.create({ payment_intent: session.payment_intent as string });`);
  assert.equal(refund.ruleId, "stripe-idempotency-unestablished");
  assert.match(refund.problem, /without an idempotencyKey/);
  assert.deepEqual(risks(`await stripe.refunds.create({ payment_intent: session.payment_intent as string }, { idempotencyKey: \`refund-\${event.id}\` });`), []);
});
