import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { buildLaunchPlan, routePath } from "../src/lib/launch-plan";
import { LaunchPlanSection } from "../src/components/launch-plan";

function snapshot(files: Record<string, string>, listedOnly: string[] = []): RepositorySnapshot {
  const paths = [...Object.keys(files), ...listedOnly];
  return { owner: "fixture", name: "shop", defaultBranch: "main", contents: new Map(Object.entries(files)), entries: paths.map(path => ({ path, type: "blob" as const })),
    sourceFilesFound: paths.length, sourceFilesRead: Object.keys(files).length, partial: false, partialReasons: [] };
}

const saas = {
  "package.json": JSON.stringify({ dependencies: { next: "16.4.2", react: "19.2.8", stripe: "18.0.0", "@supabase/supabase-js": "2.50.0", "next-auth": "5.0.0", resend: "4.0.0" }, scripts: { build: "next build" }, engines: { node: "22.x" } }),
  "package-lock.json": "{}",
  "app/layout.tsx": "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "app/page.tsx": "export default function Page() { return null; }",
  "app/api/stripe/webhook/route.ts": "import Stripe from 'stripe'; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); export async function POST(req: Request) { const sig = req.headers.get('stripe-signature')!; stripe.webhooks.constructEvent(await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET!); return new Response('ok'); }",
  "lib/supabase.ts": "import { createClient } from '@supabase/supabase-js'; export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);",
};

test("route paths drop src, route groups and slots", () => {
  assert.equal(routePath("app/api/stripe/webhook/route.ts"), "/api/stripe/webhook");
  assert.equal(routePath("src/app/(billing)/api/webhooks/stripe/route.ts"), "/api/webhooks/stripe");
  assert.equal(routePath("pages/api/webhook.ts"), "/api/webhook");
  assert.equal(routePath("pages/api/webhook/index.ts"), "/api/webhook");
  assert.equal(routePath("app/route.ts"), "/");
  assert.equal(routePath("lib/webhook.ts"), null);
});

test("facts come from package.json and the file tree", () => {
  const results = analyzeSnapshot(snapshot(saas));
  const facts = results.launchFacts!;
  assert.equal(facts.payments, "stripe");
  assert.equal(facts.auth, "Auth.js (NextAuth)");
  assert.equal(facts.email, "Resend");
  assert.equal(facts.privacyPage, false);
  assert.equal(facts.termsPage, false);
  assert.deepEqual(facts.webhooks, ["/api/stripe/webhook"]);

  const withPages = analyzeSnapshot(snapshot({ ...saas, "app/privacy/page.tsx": "export default function P() { return null; }", "app/(legal)/terms/page.tsx": "export default function T() { return null; }" })).launchFacts!;
  assert.equal(withPages.privacyPage, true);
  assert.equal(withPages.termsPage, true);
});

test("a repository without package.json gets no plan", () => {
  const results = analyzeSnapshot(snapshot({ "main.go": "package main", "go.mod": "module x" }));
  assert.equal(results.launchFacts, undefined);
});

test("the plan uses this repository's webhook path, env names and missing pages", () => {
  const plan = buildLaunchPlan(analyzeSnapshot(snapshot(saas)), "fixture/shop");
  const ids = plan.sections.map(section => section.id);
  assert.deepEqual(ids.slice(0, 1), ["deploy"]);
  assert.ok(ids.includes("payments") && ids.includes("data") && ids.includes("auth") && ids.includes("legal") && ids.includes("monitor"));
  assert.equal(ids.at(-1), "launch");
  const text = JSON.stringify(plan.sections);
  assert.match(text, /https:\/\/YOUR-DOMAIN\/api\/stripe\/webhook/);
  assert.match(text, /Row Level Security/);
  assert.match(text, /privacy policy/);
  const env = plan.sections.find(section => section.id === "env")!;
  assert.ok(env.steps.some(step => step.code?.includes("STRIPE_WEBHOOK_SECRET")));
  assert.ok(env.steps.some(step => /NEXT_PUBLIC_ names are visible/.test(step.detail)));
  assert.ok(plan.stepCount > 10);
  assert.match(plan.prompt, /never write a real secret/);
  assert.match(plan.prompt, /privacy policy page/);
  assert.match(plan.markdown, /^# Launch plan for fixture\/shop/);
  assert.match(plan.markdown, /- \[ \] \*\*/);
});

test("without a payment provider the plan suggests a payment link instead of live keys", () => {
  const files = { ...saas, "package.json": JSON.stringify({ dependencies: { next: "16.4.2", react: "19.2.8" }, scripts: { build: "next build" } }) };
  delete (files as Record<string, string>)["app/api/stripe/webhook/route.ts"];
  const plan = buildLaunchPlan(analyzeSnapshot(snapshot(files)), "fixture/shop");
  const payments = plan.sections.find(section => section.id === "payments")!;
  assert.equal(payments.title, "Decide how people pay");
  assert.equal(plan.sections.some(section => section.id === "auth"), false);
});

test("without a pass only the first section is in the HTML: no prompt, no checklist, no locked steps", () => {
  const plan = buildLaunchPlan(analyzeSnapshot(snapshot(saas)), "fixture/shop");
  for (const lang of ["en", "sv"] as const) {
    const html = renderToStaticMarkup(createElement(LaunchPlanSection, { plan, unlocked: false, lang, reportId: "r1", repoUrl: "https://github.com/fixture/shop" }));
    assert.ok(html.includes(plan.sections[0].title), lang);
    for (const section of plan.sections.slice(1)) {
      assert.ok(html.includes(section.title.replace(/&/g, "&amp;")), `${lang}: ${section.id} title shown`);
      for (const step of section.steps) assert.ok(!html.includes(step.detail.slice(0, 60).replace(/'/g, "&#x27;")), `${lang}: ${section.id} step hidden`);
    }
    assert.doesNotMatch(html, /never write a real secret|data:text\/markdown|STRIPE_WEBHOOK_SECRET\nNEXT/);
    if (lang === "sv") { assert.match(html, /19 kr/); assert.doesNotMatch(html, /\$/); }
    else { assert.match(html, /\$2/); assert.doesNotMatch(html, /\bkr\b/); }
  }
});

test("with a pass every section, the prompt and the checklist are rendered", () => {
  const plan = buildLaunchPlan(analyzeSnapshot(snapshot(saas)), "fixture/shop");
  const html = renderToStaticMarkup(createElement(LaunchPlanSection, { plan, unlocked: true, lang: "en", reportId: "r1", repoUrl: "https://github.com/fixture/shop" }));
  for (const section of plan.sections) assert.ok(html.includes(section.title.replace(/&/g, "&amp;")), section.id);
  assert.match(html, /data:text\/markdown/);
  assert.match(html, /download="launch-plan-fixture-shop\.md"/);
});

test("launch facts survive the stored report JSON", () => {
  const results = analyzeSnapshot(snapshot(saas));
  const stored = JSON.parse(JSON.stringify(results));
  assert.deepEqual(stored.launchFacts, results.launchFacts);
  assert.equal(buildLaunchPlan(stored, "fixture/shop").stepCount, buildLaunchPlan(results, "fixture/shop").stepCount);
});
