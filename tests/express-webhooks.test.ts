import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { checkProductionSafety } from "../src/lib/production-safety";
import { reportJson } from "../src/lib/report-json";
import { freeFixInstructions } from "../src/lib/fix-instructions";

const pkg = JSON.stringify({ dependencies: { express: "4.21.2", stripe: "22.6.0" } });
const head = `import express from "express";\nimport Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nconst app = express();\n`;
const handler = `(req, res) => { const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], "whsec"); res.json({ received: event.id }); }`;
const raw = `express.raw({ type: "application/json" })`;

function snapshot(files: Record<string, string>, unread: string[] = []): RepositorySnapshot {
  const all = { "package.json": pkg, ...files };
  const paths = [...Object.keys(all), ...unread];
  return { owner: "fixture", name: "shop", defaultBranch: "main", contents: new Map(Object.entries(all)), entries: paths.map(path => ({ path, type: "blob" as const })),
    sourceFilesFound: paths.length, sourceFilesRead: Object.keys(all).length, partial: unread.length > 0 };
}
const findings = (files: Record<string, string>, unread: string[] = []) => checkProductionSafety(snapshot(files, unread)).findings?.filter(f => f.ruleId === "stripe-express-body-parser") ?? [];
const server = (body: string) => findings({ "server.ts": head + body });
const lineOf = (source: string, needle: string) => source.split("\n").findIndex(line => line.includes(needle)) + 1;

test("a global express.json() before the webhook route is red, with the parser and the route on file and line", () => {
  const source = head + `app.use(express.json());\napp.post("/webhook", ${raw}, ${handler});\n`;
  const [finding, ...rest] = findings({ "server.ts": source });
  assert.equal(rest.length, 0);
  assert.equal(finding.status, "red");
  assert.equal(finding.file, "server.ts");
  assert.equal(finding.line, lineOf(source, 'app.post("/webhook"'));
  assert.match(finding.problem, new RegExp(`express\\.json\\(\\) at server\\.ts:${lineOf(source, "app.use(express.json())")}`));
  assert.match(finding.problem, /raw request bytes/);
  assert.match(finding.fix, /does not move middleware/);
  assert.match(finding.fix, /other routes/);
});

test("the webhook route before the JSON parser, or outside its path, is not reported", () => {
  assert.equal(server(`app.post("/webhook", ${raw}, ${handler});\napp.use(express.json());\n`).length, 0);
  assert.equal(server(`app.use("/api", express.json());\napp.post("/webhook", ${raw}, ${handler});\n`).length, 0);
  assert.equal(server(`app.use("/api", express.json());\napp.post("/api-webhook", ${raw}, ${handler});\n`).length, 0, "a path prefix matches whole segments only");
  assert.equal(server(`app.post("/orders", express.json(), (req, res) => res.json(req.body));\napp.post("/webhook", ${raw}, ${handler});\n`).length, 0, "route-level JSON on another path");
  assert.equal(server(`app.route("/webhook").post(${raw}, ${handler});\napp.use(express.json());\n`).length, 0);
});

test("a JSON parser scoped to a prefix that contains the webhook path is red", () => {
  const [finding] = server(`app.use("/api", express.json());\napp.post("/api/stripe/webhook", ${raw}, ${handler});\n`);
  assert.equal(finding.status, "red");
  assert.match(finding.problem, /\/api\/stripe\/webhook/);
});

test("wrappers that skip the webhook path are an accepted exception; undecidable wrappers need review", () => {
  assert.equal(server(`app.use((req, res, next) => req.originalUrl === "/webhook" ? next() : express.json()(req, res, next));\napp.post("/webhook", ${raw}, ${handler});\n`).length, 0);
  assert.equal(server(`app.use((req, res, next) => { if (req.originalUrl.startsWith("/webhook")) return next(); express.json()(req, res, next); });\napp.post("/webhook", ${raw}, ${handler});\n`).length, 0);
  assert.equal(server(`app.use((req, res, next) => { if (req.originalUrl !== "/webhook") { express.json()(req, res, next); } else { next(); } });\napp.post("/webhook", ${raw}, ${handler});\n`).length, 0);
  const [parses] = server(`app.use((req, res, next) => req.originalUrl === "/other" ? next() : express.json()(req, res, next));\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(parses.status, "red", "a wrapper that skips another path still parses the webhook");
  const [unclear] = server(`app.use((req, res, next) => shouldParse(req) ? express.json()(req, res, next) : next());\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(unclear.status, "yellow");
  assert.match(unclear.problem, /Could not establish/);
  const [wrapped] = server(`app.use(unless(express.json(), { path: ["/webhook"] }));\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(wrapped.status, "yellow");
  assert.match(wrapped.problem, /wrapped in unless\(\)/);
});

test("a verify callback that keeps the original bytes is accepted when constructEvent uses them", () => {
  const keep = `app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));\n`;
  assert.equal(server(keep + `app.post("/webhook", ${handler.replace("req.body", "req.rawBody")});\n`).length, 0);
  const [wrongField] = server(keep + `app.post("/webhook", ${handler});\n`);
  assert.equal(wrongField.status, "red");
  assert.match(wrongField.problem, /Pass req\.rawBody/);
  const [noKeep] = server(`app.use(express.json({ verify: (req, res, buf) => { if (!buf.length) throw new Error("empty"); } }));\napp.post("/webhook", ${handler});\n`);
  assert.equal(noKeep.status, "yellow", "a verify callback that keeps nothing visible is a review item");
  const [otherField] = server(`app.use(express.json());\napp.post("/webhook", ${handler.replace("req.body", "req.rawBody")});\n`);
  assert.equal(otherField.status, "yellow");
  assert.match(otherField.problem, /req\.rawBody/);
});

test("unclear middleware chains need review instead of a red finding", () => {
  const [conditional] = server(`if (process.env.PARSE_JSON) app.use(express.json());\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(conditional.status, "yellow");
  assert.match(conditional.problem, /inside a condition/);
  const [unknownPath] = findings({ "server.ts": `import { API_PREFIX } from "./config";\n` + head + `app.use(API_PREFIX, express.json());\napp.post("/webhook", ${raw}, ${handler});\n`, "config.ts": "export const API_PREFIX = process.env.PREFIX;" });
  assert.equal(unknownPath.status, "yellow");
  const [options] = server(`app.use(express.json(jsonOptions));\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(options.status, "yellow");
  assert.match(options.problem, /options/);
  const [regex] = server(`app.use(/^\\/(?!webhook).*/, express.json());\napp.post("/webhook", ${raw}, ${handler});\n`);
  assert.equal(regex.status, "yellow");
});

test("express.raw() without a JSON type does not hold Stripe's payload", () => {
  const [finding] = server(`app.post("/webhook", express.raw(), ${handler});\n`);
  assert.equal(finding.status, "yellow");
  assert.match(finding.problem, /application\/octet-stream/);
  assert.equal(server(`app.post("/webhook", express.raw({ type: "*/*" }), ${handler});\n`).length, 0);
  assert.equal(server(`app.post("/webhook", express.text({ type: "application/json" }), ${handler});\n`).length, 0);
});

test("routers and handlers in other files are followed through their imports", () => {
  const router = `import express from "express";\nimport Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nconst router = express.Router();\nrouter.post("/webhook", ${raw}, ${handler});\nexport default router;\n`;
  const mounted = findings({ "src/server.ts": `import express from "express";\nimport billing from "./routes/billing";\nconst app = express();\napp.use(express.json());\napp.use("/billing", billing);\n`, "src/routes/billing.ts": router });
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].status, "red");
  assert.equal(mounted[0].file, "src/routes/billing.ts");
  assert.match(mounted[0].problem, /\/billing\/webhook/);
  assert.match(mounted[0].problem, /src\/server\.ts:4/);
  const before = findings({ "src/server.ts": `import express from "express";\nimport billing from "./routes/billing";\nconst app = express();\napp.use("/billing", billing);\napp.use(express.json());\n`, "src/routes/billing.ts": router });
  assert.equal(before.length, 0);
  const controller = `import Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nexport function stripeWebhook(req, res) { const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], "whsec"); res.json({ ok: event.id }); }\n`;
  const imported = findings({ "server.ts": `import express from "express";\nimport { stripeWebhook } from "./controllers/webhook";\nconst app = express();\napp.use(express.json());\napp.post("/webhook", ${raw}, stripeWebhook);\n`, "controllers/webhook.ts": controller });
  assert.equal(imported[0]?.status, "red");
});

test("CommonJS apps with body-parser are read the same way", () => {
  const source = `const express = require("express");\nconst bodyParser = require("body-parser");\nconst stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);\nconst app = express();\napp.use(bodyParser.json());\napp.post("/webhook", bodyParser.raw({ type: "application/json" }), ${handler});\n`;
  const [finding] = findings({ "server.js": source });
  assert.equal(finding.status, "red");
  assert.match(finding.problem, /bodyParser\.json\(\)/);
});

test("comments and strings that mention middleware do not count as registrations", () => {
  const source = head + `// app.use(express.json());\n/* app.use(bodyParser.json()) */\nconst docs = "app.use(express.json()); app.post('/webhook', handler)";\napp.post("/webhook", ${raw}, ${handler});\napp.get("/docs", (req, res) => res.send(docs));\n`;
  assert.equal(findings({ "server.ts": source }).length, 0);
  const prose = head + `const example = \`app.use(express.json());\napp.post("/webhook", ${handler.replace(/`/g, "")})\`;\napp.get("/", (req, res) => res.send(example));\n`;
  assert.equal(findings({ "server.ts": prose }).length, 0);
});

test("incomplete snapshots never produce a red finding for a chain that was not read", () => {
  const router = `import express from "express";\nimport Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nconst router = express.Router();\nrouter.use(express.json());\nrouter.post("/webhook", ${raw}, ${handler});\nexport default router;\n`;
  const [unmounted] = findings({ "src/routes/billing.ts": router }, ["src/server.ts"]);
  assert.equal(unmounted.status, "yellow");
  assert.match(unmounted.problem, /mount point is not visible/);
  const unread = findings({ "src/server.ts": `import express from "express";\nimport billing from "./routes/billing";\nconst app = express();\napp.use(express.json());\napp.use("/billing", billing);\n` }, ["src/routes/billing.ts"]);
  assert.equal(unread.length, 0, "a webhook in an unread file is not guessed");
  const result = checkProductionSafety(snapshot({ "src/server.ts": `import express from "express";\nconst app = express();\n` }, ["src/routes/billing.ts"]));
  assert.equal(result.status, "yellow");
  assert.equal(result.coverageOnly, true);
});

test("the finding flows into the report, API JSON, Launch Readiness and copied fixes without a patch", () => {
  const results = analyzeSnapshot(snapshot({ "server.ts": head + `app.use(express.json());\napp.post("/webhook", ${raw}, ${handler});\n` }));
  const check = results.checks.find(c => c.id === "production-safety")!;
  assert.equal(check.status, "red");
  assert.ok(check.evaluatedRules?.includes("stripe-express-body-parser"));
  const report = { id: "r", repo_url: "https://github.com/fixture/shop", created_at: results.checkedAt, results };
  const json = reportJson(report);
  const blocker = json.launchReadiness.criticalBlockers.find(f => f.ruleId === "stripe-express-body-parser");
  assert.ok(blocker);
  assert.equal(blocker.repair, null);
  assert.deepEqual(blocker.evidence, [`server.ts:${blocker.line}`]);
  assert.match(freeFixInstructions(report), /express\.raw\(\{ type: 'application\/json' \}\)/);
});

test("Express webhook handlers also get the duplicate-delivery review", () => {
  const source = head + `app.post("/webhook", ${raw}, async (req, res) => { const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], "whsec"); if (event.type === "checkout.session.completed") { const session = event.data.object; await db.orders.create({ data: { email: session.customer_email } }); } res.json({ ok: true }); });\n`;
  const result = checkProductionSafety(snapshot({ "server.ts": source }));
  assert.ok(result.findings?.some(f => f.ruleId === "stripe-event-replay"));
  assert.ok(!result.findings?.some(f => f.ruleId === "stripe-express-body-parser"));
});

test("an app handed to unknown code before the route makes the chain a review item, not red", () => {
  const [finding] = findings({ "server.ts": `import { configure } from "./setup";\n` + head + `configure(app);\napp.use(express.json());\napp.post("/webhook", ${raw}, ${handler});\n`, "setup.ts": "export function configure(app) { app.disable('x-powered-by'); }" });
  assert.equal(finding.status, "yellow");
  assert.match(finding.problem, /app is passed to configure\(\), which may register middleware/);
  assert.equal(findings({ "server.ts": head + `app.use(express.json());\napp.post("/webhook", ${raw}, ${handler});\nconst server = http.createServer(app);\n` })[0].status, "red", "createServer(app) after the route does not hide the order");
});
