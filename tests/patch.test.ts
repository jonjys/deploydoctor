import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type Stripe from "stripe";
import { importProblems, type RepositorySnapshot } from "../src/lib/analyzer";
import { messages } from "../src/lib/i18n";
import { buildCasePatch, PATCH_REASONS, PatchError } from "../src/lib/patch/case-patch";
import { planCasePatch } from "../src/lib/patch/plan";
import { MAX_TOKEN_LENGTH, openQuote, quoteMetadata, sealQuote, tokenFromMetadata } from "../src/lib/patch/quote";
import { patchCheckoutParams, PATCH_AMOUNT, PATCH_FILENAME, readAccessKeys, stripeLookupFailure, validatePatchPayment, withAccessKey } from "../src/lib/patch/payments";

const secret = "test-only-session-secret-not-for-production-123456";
const reportId = "4e515536-d2b3-474f-884e-b4498baa878f";

function snapshot(files: Record<string, string>, extraPaths: string[] = []): RepositorySnapshot {
  const paths = [...Object.keys(files), ...extraPaths];
  return { owner: "acme", name: "app", defaultBranch: "main", entries: paths.map((path) => ({ path, type: "blob" as const })),
    contents: new Map(Object.entries(files)), sourceFilesFound: paths.length, sourceFilesRead: paths.length, partial: false };
}

/** Writes the files to a fresh git repository, applies the patch with real git, and returns the result. */
function applyWithGit(files: Record<string, string>, patch: string): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "patchjouren-test-"));
  try {
    for (const [path, content] of Object.entries(files)) { mkdirSync(join(dir, dirname(path)), { recursive: true }); writeFileSync(join(dir, path), content); }
    writeFileSync(join(dir, "fix.patch"), patch);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["apply", "--check", "fix.patch"], { cwd: dir });
    execFileSync("git", ["apply", "fix.patch"], { cwd: dir });
    return Object.fromEntries(Object.keys(files).map((path) => [path, readFileSync(join(dir, path), "utf8")]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a single case fix applies with git and changes only the import literal (ported ImportFix case)", () => {
  const source = "// import './widget' is an example, not code\nimport { Widget } from './widget';\nexport const value = Widget;\n";
  const result = buildCasePatch("src/page.ts", source, [{ specifier: "./widget", exact: "./Widget" }]);
  assert.deepEqual(result.applied, [{ specifier: "./widget", exact: "./Widget" }]);
  const after = applyWithGit({ "src/page.ts": source }, result.diff);
  assert.equal(after["src/page.ts"], source.replace("from './widget'", "from './Widget'"));
  // The comment is not code and stays as it was.
  assert.match(after["src/page.ts"], /^\/\/ import '\.\/widget'/);
});

test("every import form in one file becomes one diff, including a file without a final newline", () => {
  const lines = ["import a from './Alpha';", "import type { B } from \"./beta\";", ...Array.from({ length: 12 }, (_, i) => `const filler${i} = ${i};`),
    "export * from './gamma';", "const d = await import('./delta');", "const e = require(\"./epsilon\");", "type F = typeof import('./phi');"];
  const source = lines.join("\n");
  const edits = [["./beta", "./Beta"], ["./gamma", "./Gamma"], ["./delta", "./Delta"], ["./epsilon", "./EPSILON"], ["./phi", "./Phi"]]
    .map(([specifier, exact]) => ({ specifier, exact }));
  const result = buildCasePatch("src/index.ts", source, edits);
  assert.equal(result.applied.length, 5);
  assert.equal(result.diff.match(/^@@ /gm)?.length, 1, "the full file is one strict hunk");
  assert.match(result.diff, /No newline at end of file/);
  const after = applyWithGit({ "src/index.ts": source }, result.diff)["src/index.ts"];
  assert.equal(after, result.after);
  for (const [, exact] of edits.map((edit) => [edit.specifier, edit.exact])) assert.ok(after.includes(exact));
  assert.ok(after.includes("'./Alpha'"));
});

test("refuses what it cannot patch exactly", () => {
  const ok = "import x from './widget';\n";
  const edit = [{ specifier: "./widget", exact: "./Widget" }];
  const codeOf = (fn: () => unknown) => { try { fn(); return "none"; } catch (error) { return error instanceof PatchError ? error.code : "other"; } };
  assert.equal(codeOf(() => buildCasePatch("src/a.ts", "import x from './widget';\nconst = ;\n", edit)), "syntax");
  assert.equal(codeOf(() => buildCasePatch("src/a.ts", ok.replace("\n", "\r\n"), edit)), "crlf");
  assert.equal(codeOf(() => buildCasePatch("src/a.ts", `${ok}const k = "${"sk_" + "live_"}Zq8Lm3Rt7Vw2Ny5Kp1Hs9Gd4Bc6F";\n`, edit)), "secret");
  assert.equal(codeOf(() => buildCasePatch("../a.ts", ok, edit)), "path");
  assert.equal(codeOf(() => buildCasePatch("src/App.vue", ok, edit)), "path");
  assert.equal(buildCasePatch("src/a.ts", "// import x from './widget';\n", edit).skipped[0].reason, "import");
  assert.equal(buildCasePatch("src/a.ts", ok, [{ specifier: "./widget", exact: "./Widget2" }]).skipped[0].reason, "case");
  assert.equal(buildCasePatch("src/a.ts", "import x from './wid\\u0067et';\n", edit).skipped[0].reason, "escaped");
  assert.equal(buildCasePatch("src/app/r/[id]/page.tsx", ok, edit).applied.length, 1, "Next.js route paths are allowed");
});

test("the plan patches relative and @/ imports, proves them with the analyzer and leaves the rest listed", () => {
  const files = {
    "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    "src/app/page.tsx": "import Header from '../components/header';\nimport { Button } from '@/components/ui/button';\nimport Missing from './missing';\n// import Old from './old-header';\nexport default function Page() { return Header && Button && Missing; }\n",
    "src/lib/util.ts": "export const load = () => import('./Config');\n",
    "src/broken.ts": "import a from './Thing';\nconst = ;\n",
  };
  const extra = ["src/components/Header.tsx", "src/components/UI/Button.tsx", "src/lib/config.ts", "src/thing.ts", "src/app/Old-Header.tsx"];
  const before = snapshot(files, extra);
  const plan = planCasePatch(before);
  assert.deepEqual(plan.fixes.map((fix) => `${fix.file}:${fix.line} ${fix.from} -> ${fix.to}`).sort(), [
    "src/app/page.tsx:1 ../components/header -> ../components/Header",
    "src/app/page.tsx:2 @/components/ui/button -> @/components/UI/Button",
    "src/lib/util.ts:1 ./Config -> ./config",
  ]);
  assert.deepEqual(plan.files, ["src/app/page.tsx", "src/lib/util.ts"]);
  // Comments are ignored; only the file with a syntax error is refused.
  assert.deepEqual(plan.skipped.map((item) => `${item.file}:${item.line} ${item.reason}`).sort(), ["src/app/page.tsx:3 missing", "src/broken.ts:1 syntax"]);

  const patched = applyWithGit(Object.fromEntries(Object.entries(files)), plan.patch);
  const left = importProblems(snapshot(patched, extra));
  assert.deepEqual(left.map((problem) => `${problem.kind} ${problem.file}:${problem.line}`).sort(),
    ["case src/broken.ts:1", "missing src/app/page.tsx:3"]);
});

test("nothing patchable gives an empty plan with reasons, not an offer", () => {
  const plan = planCasePatch(snapshot({ "src/a.ts": "import x from './gone';\n" }));
  assert.equal(plan.fixes.length, 0);
  assert.equal(plan.patch, "");
});

const sealed = (patch = "diff --git a/a.ts b/a.ts\n") => sealQuote({ reportId, repoUrl: "https://github.com/acme/app", commitSha: "a".repeat(40),
  files: ["a.ts"], fixes: 1, patch }, secret);

test("quotes are encrypted, authenticated, compressed and fit Stripe metadata", () => {
  const { quote, token } = sealed();
  assert.equal(token.includes("diff --git"), false);
  assert.equal(openQuote(token, secret).patch, quote.patch);
  assert.throws(() => openQuote(`${token.slice(0, -6)}AAAAAA`, secret));
  assert.throws(() => openQuote(token, "another-secret-that-is-long-enough-1234567890"));
  const metadata = quoteMetadata(token, quote.accessKey, reportId);
  assert.ok(Object.keys(metadata).length <= 50);
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
  assert.equal(tokenFromMetadata(metadata), token);
  assert.throws(() => tokenFromMetadata({ ...metadata, quote_0: "tampered" }));

  // A realistic multi-file patch compresses well below the metadata ceiling.
  const big = Array.from({ length: 12 }, (_, i) => `diff --git a/src/file${i}.ts b/src/file${i}.ts\n--- a/src/file${i}.ts\n+++ b/src/file${i}.ts\n@@ -1,7 +1,7 @@\n import a from './one';\n-import b from './two';\n+import b from './Two';\n const c = 1;\n`).join("");
  assert.ok(sealed(big).token.length < MAX_TOKEN_LENGTH);
});

test("an expired quote cannot start a checkout, but a paid one can still be opened", () => {
  const { quote, token } = sealed();
  assert.throws(() => openQuote(token, secret, true, (quote.expiresAt - 60) * 1000), (error: unknown) => error instanceof PatchError && error.code === "expired");
  assert.equal(openQuote(token, secret, false, (quote.expiresAt + 3600) * 1000).patch, quote.patch);
});

test("checkout is one $5 payment that carries the quote and returns to the patch page", () => {
  const { quote, token } = sealed();
  const params = patchCheckoutParams(token, secret, "https://deploydoctor.example", "sv");
  assert.equal(params.mode, "payment");
  assert.equal(params.line_items?.[0].price_data?.unit_amount, PATCH_AMOUNT);
  assert.equal(params.line_items?.[0].price_data?.currency, "usd");
  assert.equal(params.subscription_data, undefined);
  assert.deepEqual(params.adaptive_pricing, { enabled: false });
  assert.equal(params.expires_at, quote.expiresAt);
  assert.equal(params.locale, "sv");
  // The internal id is frozen: open sessions and paid orders are matched on it. Buyers see the DeployDoctor name.
  assert.equal(params.metadata?.app, "patchjouren");
  assert.equal(params.line_items?.[0].price_data?.product_data?.name, "DeployDoctor: verifierad importpatch");
  assert.equal(params.metadata?.report_id, reportId);
  assert.equal(params.success_url, "https://deploydoctor.example/patch/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, `https://deploydoctor.example/r/${reportId}#check-imports`);
  assert.equal(tokenFromMetadata(params.metadata as Record<string, string>), token);
});

function paidSession() {
  const { quote, token } = sealed();
  return { quote, session: {
    metadata: quoteMetadata(token, quote.accessKey, reportId), mode: "payment", currency: "usd", amount_total: PATCH_AMOUNT,
    status: "complete", payment_status: "paid",
    payment_intent: { status: "succeeded", amount_received: PATCH_AMOUNT, currency: "usd", latest_charge: { status: "succeeded", paid: true, refunded: false, amount_refunded: 0, disputed: false } },
  } as unknown as Stripe.Checkout.Session };
}

test("only a confirmed, matching, unrefunded payment and the buyer's access key release the patch", () => {
  const { quote, session } = paidSession();
  assert.equal(validatePatchPayment(session, secret, quote.accessKey).patch, quote.patch);
  const code = (candidate: Stripe.Checkout.Session, key = quote.accessKey) => {
    try { validatePatchPayment(candidate, secret, key); return "released"; } catch (error) { return error instanceof PatchError ? error.code : "other"; }
  };
  assert.equal(code(session, "0".repeat(64)), "access");
  assert.equal(code(session, ""), "access");
  for (const change of [{ amount_total: 1 }, { currency: "sek" }, { mode: "subscription" }, { metadata: { ...session.metadata, app: "deploydoctor" } }])
    assert.equal(code({ ...session, ...change } as Stripe.Checkout.Session), "payment", JSON.stringify(change));
  assert.equal(code({ ...session, status: "open" } as Stripe.Checkout.Session), "payment");
  assert.equal(code({ ...session, payment_status: "unpaid" } as Stripe.Checkout.Session), "pending");
  const intent = session.payment_intent as Stripe.PaymentIntent;
  assert.equal(code({ ...session, payment_intent: { ...intent, status: "processing" } } as Stripe.Checkout.Session), "pending");
  for (const change of [{ refunded: true }, { amount_refunded: 1 }, { disputed: true }, { paid: false }]) {
    const charge = { ...(intent.latest_charge as Stripe.Charge), ...change };
    assert.equal(code({ ...session, payment_intent: { ...intent, latest_charge: charge } } as Stripe.Checkout.Session), "payment", JSON.stringify(change));
  }
});

test("an order ID Stripe does not know is an unknown order, anything else is a retryable outage", () => {
  const missing = stripeLookupFailure({ statusCode: 404, code: "resource_missing" });
  assert.equal(missing.status, 404);
  assert.equal(missing.code, "payment");
  assert.equal(stripeLookupFailure({ statusCode: 500 }).status, 503);
  assert.equal(stripeLookupFailure(new Error("socket hang up")).status, 503);
});

test("the access cookie keeps the latest five keys, newest first, and ignores junk", () => {
  const keys = Array.from({ length: 7 }, (_, i) => String(i).repeat(64));
  let cookie: string | undefined;
  for (const key of keys) cookie = withAccessKey(cookie, key);
  assert.deepEqual(readAccessKeys(cookie), keys.slice(2).reverse());
  assert.deepEqual(readAccessKeys(`${"a".repeat(64)}.not-a-key.${"b".repeat(63)}`), ["a".repeat(64)]);
  assert.deepEqual(readAccessKeys(undefined), []);
});

test("every refusal code has a message in both languages", () => {
  for (const reason of PATCH_REASONS) {
    for (const lang of ["en", "sv"] as const) assert.ok((messages[lang] as Record<string, string>)[`patch.reason.${reason}`], `${lang} patch.reason.${reason}`);
  }
  for (const reason of ["no-imports", "private", "nothing", "truncated"]) assert.ok((messages.sv as Record<string, string>)[`patch.none.${reason}`]);
  for (const lang of ["en", "sv"] as const) {
    const text = messages[lang] as Record<string, string>;
    assert.ok(text["patch.download"].endsWith(PATCH_FILENAME), `${lang} download button names the file`);
    assert.ok(!Object.values(text).some((value) => /patchjouren/i.test(value)), `${lang} shows no working name`);
  }
});
