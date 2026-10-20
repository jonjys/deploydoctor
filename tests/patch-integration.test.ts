import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createCipheriv, createHmac } from "node:crypto";
import { deflateRawSync, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pack } from "tar-stream";
import Stripe from "stripe";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { planCasePatch } from "../src/lib/patch/plan";
import { applyVerifiedDiff, buildCasePatch, sourceHash } from "../src/lib/patch/case-patch";
import { openQuote, sealQuote, quoteMetadata, tokenHash } from "../src/lib/patch/quote";
import { validatePatchPayment, PATCH_AMOUNT } from "../src/lib/patch/payments";
import { downloadToken, verifyDownloadToken, paidPatchResponse, restorePatchPurchase } from "../src/lib/patch/delivery";
import { handlePatchEvent } from "../src/lib/patch/webhook";
import { boundedBody } from "../src/lib/bounded-body";

const require = createRequire(import.meta.url);
// Node is the server in this test; bypass only the browser-bundling sentinel.
require.cache[require.resolve("server-only")] = { exports: {}, loaded: true } as NodeModule;
const secret = "fixture-session-secret-not-a-real-key-1234567890";
const reportId = "4e515536-d2b3-474f-884e-b4498baa878f";
const commit = "a".repeat(40);
const sessionId = "cs_test_integration1234567890";
const source = "// import a from './fake';\nconst example = \"require('./fake')\";\nimport Widget from './widget';\nexport { Widget } from './widget';\n";
const snapshot = (paths: string[]): RepositorySnapshot => ({ owner: "fixture", name: "app", defaultBranch: "main",
  contents: new Map([["src/main.ts", source]]), entries: ["src/main.ts", ...paths].map(path => ({ path, type: "blob" })),
  sourceFilesRead: 1, sourceFilesFound: paths.length + 1, partial: false });

test("DeployFix ambiguity cases require review, including collisions across source extensions", () => {
  for (const targets of [["src/Widget.ts", "src/WIDGET.ts"], ["src/Widget.ts", "src/Widget.tsx"]]) {
    const plan = planCasePatch(snapshot(targets));
    assert.equal(plan.patch, ""); assert.equal(plan.fixes.length, 0);
    assert.ok(plan.skipped.every(item => item.reason === "ambiguous"));
    assert.equal(analyzeSnapshot(snapshot(targets)).checks.find(item => item.id === "imports")?.status, "yellow");
  }
});

test("real imports and exports are patched while comment/string lookalikes stay unchanged", () => {
  const plan = planCasePatch(snapshot(["src/Widget.ts"]));
  assert.equal(plan.fixes.length, 2);
  const after = applyVerifiedDiff("src/main.ts", source, plan.patch);
  assert.ok(after.includes("// import a from './fake'"));
  assert.ok(after.includes('"require(\'./fake\')"'));
  assert.ok(after.includes("from './Widget'"));
  assert.equal(plan.sourceHashes?.["src/main.ts"], sourceHash(source));
});

test("full-context patches pass real git and reject modifications far from the import", () => {
  const dir = mkdtempSync(join(tmpdir(), "deploydoctor-pinned-"));
  try {
    mkdirSync(join(dir, "src"));
    const before = "import Widget from './widget';\n" + Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`).join("\n") + "\n";
    const { diff, after } = buildCasePatch("src/main.ts", before, [{ specifier: "./widget", exact: "./Widget" }]);
    writeFileSync(join(dir, "src/main.ts"), before); writeFileSync(join(dir, "fix.patch"), diff);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "src/main.ts"], { cwd: dir });
    execFileSync("git", ["apply", "--check", "--index", "fix.patch"], { cwd: dir });
    assert.equal(applyVerifiedDiff("src/main.ts", before, diff), after);
    for (const changed of [before.replace("line29 = 29", "line29 = 999"), before + "// appended\n", before.replace("./widget", "./other")]) {
      writeFileSync(join(dir, "src/main.ts"), changed);
      assert.throws(() => execFileSync("git", ["apply", "--check", "--index", "fix.patch"], { cwd: dir, stdio: "pipe" }));
      assert.throws(() => applyVerifiedDiff("src/main.ts", changed, diff));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("new encrypted artifacts are bound to their report; legacy paid artifacts remain readable", () => {
  const { quote, token } = sealQuote({ reportId, commitSha: commit, repoUrl: "https://github.com/fixture/app", files: ["src/main.ts"], fixes: 1, patch: "patch" }, secret);
  assert.ok(token.startsWith(`p2.${reportId}.`));
  assert.throws(() => openQuote(token.replace(reportId, "1".repeat(8) + reportId.slice(8)), secret));
  const iv = Buffer.alloc(12, 7);
  const key = createHmac("sha256", secret).update("patchjouren:quote:encryption:v1").digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(deflateRawSync(JSON.stringify(quote))), cipher.final()]);
  const legacy = `p1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
  assert.equal(openQuote(legacy, secret, false).patch, quote.patch);
});

function paymentFixture() {
  const { quote, token } = sealQuote({ reportId, commitSha: commit, repoUrl: "https://github.com/fixture/app", files: ["src/main.ts"], fixes: 1, patch: "verified diff" }, secret);
  const session = { id: sessionId, livemode: false, metadata: quoteMetadata(token, quote.accessKey, reportId),
    mode: "payment", status: "complete", payment_status: "paid", amount_total: PATCH_AMOUNT, currency: "usd",
    payment_intent: { status: "succeeded", amount_received: PATCH_AMOUNT, currency: "usd",
      latest_charge: { status: "succeeded", paid: true, refunded: false, amount_refunded: 0, disputed: false } },
  } as unknown as Stripe.Checkout.Session;
  return { quote, session };
}

test("delivery links expire, are session-bound, and never grant access to a stranger", () => {
  const key = "b".repeat(64), now = Date.now();
  const token = downloadToken(sessionId, tokenHash(key), secret, now);
  assert.doesNotThrow(() => verifyDownloadToken(token, sessionId, [key], secret, now));
  for (const keys of [[], ["c".repeat(64)]]) assert.throws(() => verifyDownloadToken(token, sessionId, keys, secret, now));
  assert.throws(() => verifyDownloadToken(token, sessionId + "wrong", [key], secret, now));
  assert.throws(() => verifyDownloadToken(token, sessionId, [key], secret, now + 901_000));
  assert.throws(() => verifyDownloadToken(token + "0", sessionId, [key], secret, now));
  assert.ok(!token.includes(key));
});

test("exact amount, environment, report, successful PaymentIntent and charge are all required", () => {
  const { quote, session } = paymentFixture();
  assert.doesNotThrow(() => validatePatchPayment(session, secret, quote.accessKey, false));
  assert.throws(() => validatePatchPayment(session, secret, quote.accessKey, true));
  assert.throws(() => validatePatchPayment({ ...session, metadata: { ...session.metadata, report_id: "wrong" } }, secret, quote.accessKey));
  for (const change of [{ amount_received: 1 }, { currency: "sek" }]) {
    assert.throws(() => validatePatchPayment({ ...session, payment_intent: { ...(session.payment_intent as Stripe.PaymentIntent), ...change } } as Stripe.Checkout.Session, secret));
  }
});

test("purchase recovery, download, replayed webhooks and refund/dispute revocation form one flow", async () => {
  const { retrievePaidPatch } = await import("../src/lib/patch/service");
  const { quote, session } = paymentFixture();
  let reads = 0;
  const loadSession = async () => { reads++; return session; };
  const dependencies = { loadSession, reserve: async () => null, secret, live: false };
  const loadOrder = (id: string, keys: string[]) => retrievePaidPatch(id, keys, dependencies);
  await assert.rejects(() => loadOrder(sessionId, [])); assert.equal(reads, 0);
  await assert.rejects(() => restorePatchPurchase(sessionId, "c".repeat(64), loadOrder));
  assert.equal(await restorePatchPurchase(sessionId, quote.accessKey, loadOrder), `/patch/success?session_id=${sessionId}`);
  const token = downloadToken(sessionId, tokenHash(quote.accessKey), secret);
  const request = new Request(`https://fixture.test/api/patch/download?session_id=${sessionId}&token=${token}`);
  const response = await paidPatchResponse(request, [quote.accessKey], secret, loadOrder);
  assert.equal(response.status, 200); assert.equal(await response.text(), quote.patch);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  await assert.rejects(() => paidPatchResponse(request, [], secret, loadOrder));
  const event = { type: "checkout.session.completed", data: { object: { id: sessionId, metadata: session.metadata } } } as Stripe.Event;
  for (let i = 0; i < 2; i++) assert.equal(await handlePatchEvent(event, secret, false, loadSession), true);
  const charge = (session.payment_intent as Stripe.PaymentIntent).latest_charge as Stripe.Charge;
  for (const state of [{ amount_refunded: 1 }, { amount_refunded: 0, disputed: true }, { disputed: false, refunded: true }]) {
    Object.assign(charge, state);
    await handlePatchEvent(event, secret, false, loadSession); // A late success must not resurrect access.
    await assert.rejects(() => paidPatchResponse(request, [quote.accessKey], secret, loadOrder));
    await assert.rejects(() => restorePatchPurchase(sessionId, quote.accessKey, loadOrder));
  }
  await assert.rejects(() => handlePatchEvent(event, secret, false, async () => { throw Error("Stripe unavailable"); }));
});

test("real Stripe signature verification rejects tampered, stale and unsigned webhook bodies", () => {
  const stripe = new Stripe("sk_test_fixture_not_real");
  const payload = JSON.stringify({ id: "evt_fixture", type: "checkout.session.completed", data: { object: { id: sessionId } } });
  const timestamp = Math.floor(Date.now() / 1000), key = "whsec_fixture_not_real";
  const signature = `t=${timestamp},v1=${createHmac("sha256", key).update(`${timestamp}.${payload}`).digest("hex")}`;
  assert.equal(stripe.webhooks.constructEvent(payload, signature, key).id, "evt_fixture");
  assert.throws(() => stripe.webhooks.constructEvent(payload + " ", signature, key));
  assert.throws(() => stripe.webhooks.constructEvent(payload, "", key));
  const stale = timestamp - 301;
  assert.throws(() => stripe.webhooks.constructEvent(payload, `t=${stale},v1=${createHmac("sha256", key).update(`${stale}.${payload}`).digest("hex")}`, key));
});

test("chunked request bodies are cancelled at the byte limit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBody({ body } as Pick<Request, "body">, 100), RangeError);
  assert.equal(cancelled, true);
});

test("GitHub scans and patch offers use the same immutable commit despite a moving default branch", async () => {
  const { analyzeGitHubRepository } = await import("../src/lib/github");
  const { preparePatchForReport, createPatchCheckout } = await import("../src/lib/patch/service");
  const originalFetch = globalThis.fetch;
  const previous = { SESSION_SECRET: process.env.SESSION_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY };
  Object.assign(process.env, { SESSION_SECRET: secret, SUPABASE_URL: "https://database.fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.fixture", SUPABASE_SECRET_KEY: "fixture" });
  const tar = pack();
  tar.entry({ name: "fixture-sha/package.json" }, '{"dependencies":{"next":"16.4.2"}}');
  tar.entry({ name: "fixture-sha/src/main.ts" }, source);
  tar.entry({ name: "fixture-sha/src/Widget.ts" }, "export default 1;\n");
  tar.finalize(); const chunks: Buffer[] = []; for await (const chunk of tar) chunks.push(chunk);
  const archive = gzipSync(Buffer.concat(chunks));
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.includes("database.fixture")) {
      if (url.includes("acquire_work_budget")) return Response.json({ allowed: true, lease: "fixture" });
      return Response.json([]);
    }
    if (url.endsWith("/repos/fixture/app")) return Response.json({ default_branch: "main", private: false, pushed_at: "today" });
    if (url.endsWith("/commits/main")) return Response.json({ sha: commit });
    if (url.endsWith(`/tarball/${commit}`)) return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/fixture/app/tar.gz/${commit}` } });
    if (url.startsWith("https://codeload.github.com/")) {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response(archive);
    }
    if (url.includes(`/git/trees/${commit}?`)) return Response.json({ truncated: false, tree: [
      { path: "src/main.ts", type: "blob", sha: "b".repeat(40), mode: "100644", size: source.length },
      { path: "src/Widget.ts", type: "blob", sha: "c".repeat(40), mode: "100644", size: 18 },
    ] });
    if (url.includes("/git/blobs/")) return Response.json({ encoding: "base64", content: Buffer.from(source).toString("base64") });
    throw Error(`Unexpected URL: ${url}`);
  };
  try {
    const scan = await analyzeGitHubRepository("https://github.com/fixture/app");
    assert.equal(scan.results.repository.commitSha, commit);
    const offer = await preparePatchForReport(new Request("https://fixture.test"), { id: reportId, repo_url: scan.canonicalUrl, results: scan.results, created_at: new Date().toISOString() });
    assert.equal(offer.eligible, true);
    if (!offer.eligible) throw Error("Expected offer");
    assert.equal(offer.commitSha, commit);
    await assert.rejects(() => createPatchCheckout(offer.quoteToken, "https://fixture.test", "en", []), (error: unknown) => (error as { status: number }).status === 403);
    assert.equal(openQuote(offer.quoteToken, secret).sourceHashes?.["src/main.ts"], sourceHash(source));
    assert.ok(!calls.some(url => url.includes("/tarball/main") || url.includes("/git/ref/")));
    assert.ok(calls.length < 15);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
