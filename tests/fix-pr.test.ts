import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";
import { buildCasePatch, PatchError, sourceHash } from "../src/lib/patch/case-patch";
import { sealQuote } from "../src/lib/patch/quote";
import { PullRequestApiError, type GitRequest } from "../src/lib/patch/pull-request";
import { FIX_AMOUNT, FIX_APP, FIX_PROMO_CAP } from "../src/lib/fix-pr/constants";
import { handleFixEvent } from "../src/lib/fix-pr/events";
import { githubAppJwt, readCheckEvent, verifyGithubWebhook } from "../src/lib/fix-pr/github-app";
import { openGatedFixPullRequest, readGatedFixPatch } from "../src/lib/fix-pr/open";
import { buildOutcome, refundReason } from "../src/lib/fix-pr/outcome";
import { fixCheckoutParams, validateFixPayment } from "../src/lib/fix-pr/payments";
import { claimPromoSlot, openPromoReceipt, sealPromoReceipt } from "../src/lib/fix-pr/promo";
import { parseFixTarget } from "../src/lib/fix-pr/target";
import { cleanLiveUrl, rescueEntry } from "../src/lib/fix-pr/wall";

const secret = "fix-pr-test-secret-must-be-32-characters-long";
const reportId = "11111111-1111-4111-8111-111111111111";
const source = "import Widget from './widget';\nexport const page = Widget;\n";
const base = "a".repeat(40);
const tree = "b".repeat(40);
const changed = "c".repeat(40);
const fixed = "d".repeat(40);
const built = buildCasePatch("src/main.ts", source, [{ specifier: "./widget", exact: "./Widget" }]);
const sealed = sealQuote({
  reportId, repoUrl: "https://github.com/acme/demo", commitSha: base, files: ["src/main.ts"], fixes: 1,
  patch: built.diff, sourceHashes: { "src/main.ts": sourceHash(source) },
}, secret);

function mock() {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const api: GitRequest = async <T,>(path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    let result: unknown;
    if (path === "/repos/acme/demo") result = { full_name: "acme/demo", default_branch: "main", private: false, permissions: { push: true } };
    else if (path.includes("/pulls?")) result = [];
    else if (path.endsWith("/git/ref/heads/main")) result = { object: { sha: base } };
    else if (path.includes("/git/ref/heads/deploydoctor")) throw new PullRequestApiError(404);
    else if (path.endsWith(`/git/commits/${base}`)) result = { tree: { sha: tree } };
    else if (path.includes("/git/trees/") && method === "GET") result = { truncated: false, tree: [{ path: "src/main.ts", type: "blob", mode: "100644", sha: tree, size: source.length }] };
    else if (path.includes("/git/blobs/")) result = { encoding: "base64", content: Buffer.from(source).toString("base64") };
    else if (path.endsWith("/git/trees") && method === "POST") result = { sha: changed };
    else if (path.endsWith("/git/commits") && method === "POST") result = { sha: fixed };
    else if (path.endsWith("/git/refs") && method === "POST") result = { ref: "created" };
    else if (path.endsWith("/pulls") && method === "POST") result = { html_url: "https://github.com/acme/demo/pull/7", state: "open", draft: false };
    else throw new Error(`Unexpected ${method} ${path}`);
    return result as T;
  };
  return { api, calls };
}

function session(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  const params = fixCheckoutParams(sealed.token, secret, "https://deploydoctor.example", "en", { consent: true, liveUrl: "https://shop.example", errorSummary: "Module not found" });
  return {
    id: "cs_test_fixpr1234567890", livemode: false, metadata: params.metadata, mode: "payment", currency: "usd", amount_total: FIX_AMOUNT,
    status: "complete", payment_status: "paid",
    payment_intent: { status: "succeeded", amount_received: FIX_AMOUNT, currency: "usd", latest_charge: { status: "succeeded", paid: true, refunded: false, amount_refunded: 0, disputed: false } },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

test("a repo URL, a Vercel build log and a live URL are told apart", () => {
  assert.deepEqual(parseFixTarget("https://github.com/acme/shop"), { kind: "repo", repo: "acme/shop" });
  assert.deepEqual(parseFixTarget("acme/shop"), { kind: "repo", repo: "acme/shop" });
  assert.deepEqual(parseFixTarget("Cloning github.com/acme/shop (Branch: main, Commit: abc)\nerror"), { kind: "repo", repo: "acme/shop" });
  assert.deepEqual(parseFixTarget("https://shop.vercel.app"), { kind: "needs-repo", liveUrl: "https://shop.vercel.app" });
  assert.equal(parseFixTarget("javascript:alert(1)"), null);
  assert.equal(parseFixTarget("https://user:pass@github.com/acme/shop"), null);
});

test("checkout is one $5 payment and an unpaid session never reaches GitHub", async () => {
  const params = fixCheckoutParams(sealed.token, secret, "https://deploydoctor.example", "en");
  assert.equal(params.mode, "payment");
  assert.equal(params.line_items?.[0].price_data?.unit_amount, 500);
  assert.equal(params.metadata?.app, FIX_APP);
  assert.equal(params.payment_method_types, undefined);
  assert.match(params.integration_identifier ?? "", /^deploydoctor_fix_checkout_[a-z]{8}$/);
  const unpaid = session({ status: "open", payment_status: "unpaid", payment_intent: null });
  const blocked = mock();
  await assert.rejects(() => openGatedFixPullRequest({ session: unpaid, promoReceipt: null, quoteToken: "", secret, live: false, summary: "case", api: blocked.api }), (error: unknown) => error instanceof PatchError);
  assert.equal(blocked.calls.length, 0);
  assert.throws(() => readGatedFixPatch({ session: unpaid, promoReceipt: null, quoteToken: "", secret, live: false }));
  assert.equal(blocked.calls.length, 0);
});

test("a paid session opens one pull request and releases the diff; a promo receipt does the same without Stripe", async () => {
  const paid = session();
  assert.equal(validateFixPayment(paid, secret, false).patch, built.diff);
  const { api, calls } = mock();
  const opened = await openGatedFixPullRequest({ session: paid, promoReceipt: null, quoteToken: "", secret, live: false, summary: "Import case", api });
  assert.equal(opened.url, "https://github.com/acme/demo/pull/7");
  assert.equal(opened.paid, true);
  const pull = calls.find((call) => call.path.endsWith("/pulls") && call.method === "POST")!.body as { draft: boolean; title: string; head: string };
  assert.equal(pull.draft, false);
  assert.equal(pull.title, "Fix the failed deploy");
  assert.match(pull.head, /^deploydoctor\/fix-[a-f0-9]{24}$/);
  assert.equal(readGatedFixPatch({ session: paid, promoReceipt: null, quoteToken: "", secret, live: false }).patch, built.diff);
  const receipt = sealPromoReceipt(sealed.token, 1, secret);
  const promo = mock();
  const free = await openGatedFixPullRequest({ session: null, promoReceipt: receipt, quoteToken: sealed.token, secret, summary: "Import case", api: promo.api });
  assert.equal(free.paid, false);
  assert.ok(promo.calls.some((call) => call.path.endsWith("/pulls") && call.method === "POST"));
  assert.throws(() => openPromoReceipt(receipt.slice(0, -4) + "aaaa", sealed.token, secret));
});

test("the launch counter stops at 50 and a failed build is the refund, not a pending check", () => {
  let claimed = 0;
  for (let n = 0; n < FIX_PROMO_CAP; n += 1) {
    const step = claimPromoSlot(claimed);
    assert.equal(step.granted, true);
    claimed = step.claimed;
  }
  assert.deepEqual(claimPromoSlot(claimed), { granted: false, claimed: 50, cap: 50 });
  assert.equal(buildOutcome([]), "pending");
  assert.equal(buildOutcome([{ status: "in_progress", conclusion: null }]), "pending");
  assert.equal(buildOutcome([{ status: "completed", conclusion: "failure" }]), "failed");
  assert.equal(buildOutcome([{ status: "completed", conclusion: "success" }]), "passed");
  assert.equal(refundReason({ outcome: "pending", prUrl: "https://github.com/acme/demo/pull/7", deliveryFailed: false, alreadyRefunded: false }), null);
  assert.equal(refundReason({ outcome: "failed", prUrl: "https://github.com/acme/demo/pull/7", deliveryFailed: false, alreadyRefunded: false }), "build_failed");
  assert.equal(refundReason({ outcome: "pending", prUrl: null, deliveryFailed: true, alreadyRefunded: false }), "not_delivered");
  assert.equal(refundReason({ outcome: "failed", prUrl: "https://github.com/acme/demo/pull/7", deliveryFailed: false, alreadyRefunded: true }), null);
});

test("the rescue wall keeps only consented public https results and strips secrets", () => {
  const fixedAt = "2026-11-03T00:00:00.000Z";
  const shown = rescueEntry({
    consent: true, isPrivate: false, repo: "https://github.com/acme/shop", error: "Build failed sk_live_abcdefghijklmnopqrstuv",
    liveUrl: "https://shop.vercel.app/welcome/", prUrl: "https://github.com/acme/shop/pull/4", fixedAt,
  });
  assert.equal(shown?.liveUrl, "https://shop.vercel.app/welcome");
  assert.match(shown?.error ?? "", /\[redacted\]/);
  assert.doesNotMatch(shown?.error ?? "", /sk_live_/);
  assert.equal(rescueEntry({ consent: false, isPrivate: false, repo: "https://github.com/acme/shop", error: "Build failed on import case", liveUrl: "https://shop.vercel.app", prUrl: "https://github.com/acme/shop/pull/4", fixedAt }), null);
  assert.equal(cleanLiveUrl("https://github.com/acme/shop"), null);
  assert.equal(cleanLiveUrl("http://shop.vercel.app"), null);
});

test("stripe fulfillment accepts a paid fix session and ignores an unpaid one without opening a pull request", async () => {
  const paid = session();
  const unpaid = session({ status: "open", payment_status: "unpaid", payment_intent: null });
  const event = (object: Stripe.Checkout.Session): Stripe.Event => ({ id: "evt_fix", type: "checkout.session.completed", data: { object } } as Stripe.Event);
  assert.equal(await handleFixEvent(event(unpaid), secret, false, async () => unpaid), true);
  assert.equal(await handleFixEvent(event(paid), secret, false, async () => paid), true);
  assert.equal(await handleFixEvent({ id: "evt_other", type: "checkout.session.completed", data: { object: { metadata: { app: "deploydoctor" } } } } as unknown as Stripe.Event, secret, false, async () => paid), false);
});

test("a GitHub App JWT verifies and a check webhook names the pull request", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = githubAppJwt("4242", pem, 1_700_000_000);
  const [header, payload, signature] = jwt.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${header}.${payload}`);
  assert.equal(verify.verify(publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).iss, "4242");
  const raw = JSON.stringify({ action: "completed", repository: { full_name: "acme/shop" }, check_run: { conclusion: "failure", head_sha: "a".repeat(40), pull_requests: [{ number: 4 }] } });
  assert.equal(verifyGithubWebhook(raw, `sha256=${createHmac("sha256", "hook-secret").update(raw).digest("hex")}`, "hook-secret"), true);
  assert.deepEqual(readCheckEvent(JSON.parse(raw)), { conclusion: "failure", headSha: "a".repeat(40), prUrls: ["https://github.com/acme/shop/pull/4"] });
  assert.equal(verifyGithubWebhook(raw, "sha256=00", "hook-secret"), false);
});

test("the promo counter is service-role only and stops at 50, including a repeated quote", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(readFileSync(new URL("../supabase/migrations/20261103070000_fix_pr.sql", import.meta.url), "utf8"));
    await db.exec("set role anon;");
    await assert.rejects(() => db.query("select * from fix_promo"));
    await assert.rejects(() => db.query("select * from fix_orders"));
    await db.exec("reset role; set role service_role;");
    const hash = "ab".repeat(32);
    const claim = (value: string) => db.query<{ granted: boolean; claimed: number; cap: number }>("select * from claim_fix_promo($1)", [value]);
    const first = await claim(hash);
    assert.equal(first.rows[0].granted, true);
    assert.equal(first.rows[0].claimed, 1);
    const again = await claim(hash);
    assert.equal(again.rows[0].granted, true);
    assert.equal(again.rows[0].claimed, 1);
    for (let n = 2; n <= 50; n += 1) {
      const row = await claim("cd".repeat(31) + n.toString(16).padStart(2, "0"));
      assert.equal(row.rows[0].granted, true, String(n));
    }
    const blocked = await claim("ff".repeat(32));
    assert.equal(blocked.rows[0].granted, false);
    assert.equal(blocked.rows[0].claimed, 50);
    const left = await db.query<{ remaining: number }>("select * from fix_promo_remaining()");
    assert.equal(left.rows[0].remaining, 0);
  } finally { await db.close(); }
});
