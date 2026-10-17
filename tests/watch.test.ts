import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { analysisText } from "../src/lib/analysis-text";
import { messages } from "../src/lib/i18n";
import { auditMigrations } from "../src/lib/supabase-sql";
import { parseVercelCron, runsMoreThanOnceADay } from "../src/lib/vercel-cron";
import {
  alertEmail, confirmationEmail, cronAuthorized, cronSecret, hashWatchToken, isWatchToken, newFindings, newWatchToken, normalizeEmail,
  reportLang, runWatchCron, sendWatchEmail, transientPartial, unsubscribeToken, verifyUnsubscribeToken, watchConfig, watchEnabled,
  type NewFinding, type WatchCronDeps, type WatchEmail, type WatchRow,
} from "../src/lib/watch";
import type { CheckResult, CheckStatus, Finding, ReportResults, StoredReport } from "../src/types/report";

process.env.SESSION_SECRET ||= "test-session-secret-that-is-long-enough-123";

const ENV = { RESEND_API_KEY: "re_test", WATCH_FROM_EMAIL: "DeployDoctor <watch@example.com>" };

function check(id: CheckResult["id"], status: CheckStatus, findings?: Array<Partial<Finding>>, lang: "en" | "sv" = "en"): CheckResult {
  const titles = analysisText(lang).titles;
  const title = { "next-entry": titles.nextEntry, imports: titles.imports, "server-libs": titles.serverLibs, env: titles.env, supabase: titles.supabase,
    prisma: titles.prisma, "build-config": titles.buildConfig, secrets: titles.secrets, dependencies: titles.dependencies }[id];
  return { id, title, status, explanation: `${id} is ${status}`, fix: "fix it", evidence: [],
    ...(findings ? { findings: findings.map((item) => ({ file: "src/app/page.tsx", line: 1, problem: "problem", fix: "fix", ...item })) } : {}) };
}

function results(checks: CheckResult[], reasons?: string[]): ReportResults {
  return {
    repository: { owner: "acme", name: "shop", defaultBranch: "main" }, checkedAt: "2026-10-01T00:00:00.000Z",
    scan: { filesInTree: 10, sourceFilesRead: 5, sourceFilesFound: 5, partial: Boolean(reasons?.length), reasons },
    summary: { red: 0, yellow: 0, green: 0 }, overall: "green", checks,
  };
}

test("watch tokens are 32 random bytes and only their SHA-256 is stored", () => {
  const first = newWatchToken();
  const second = newWatchToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first.token, "base64url").length, 32);
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash, createHash("sha256").update(first.token).digest("hex"));
  assert.equal(hashWatchToken(first.token), first.hash);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(first.hash, first.token);
  assert.equal(isWatchToken(first.token), true);
  for (const value of [first.hash, "", "short", `${first.token}x`, `${first.token.slice(0, 42)}=`, null, 42]) assert.equal(isWatchToken(value), false, String(value));
});

test("unsubscribe links are signed watch ids that only verify unchanged", () => {
  const id = "4e515536-d2b3-474f-884e-b4498baa878f";
  const token = unsubscribeToken(id);
  assert.equal(verifyUnsubscribeToken(token), id);
  assert.equal(verifyUnsubscribeToken(unsubscribeToken(id)), id, "stable, so links in old emails keep working");
  const [, signature] = token.split(".");
  const flipped = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  assert.equal(verifyUnsubscribeToken(`${id}.${flipped}`), null);
  assert.equal(verifyUnsubscribeToken(`c90b4327-500c-4a40-8019-a77df7773ef5.${signature}`), null, "a signature never moves to another watch");
  for (const value of [id, `${id}.`, `${id}.${signature}.x`, "not-a-token", null, undefined, 7]) assert.equal(verifyUnsubscribeToken(value), null, String(value));
});

test("email addresses are trimmed, lower-cased and must be a single plain address", () => {
  assert.equal(normalizeEmail("  Dev@Example.COM "), "dev@example.com");
  assert.equal(normalizeEmail("first.last+tag@sub.example.se"), "first.last+tag@sub.example.se");
  for (const value of ["", "a@b", "no-at.example.com", "a b@example.com", "a@example.com, b@example.com", "<a@example.com>", "a@example.com\nBcc: b@x.se",
    "a@-example.com", `${"a".repeat(250)}@example.com`, null, 3, ["a@example.com"]]) {
    assert.equal(normalizeEmail(value), null, String(value));
  }
});

test("the cron job needs CRON_SECRET of at least 16 characters and the exact Bearer header", () => {
  assert.equal(cronSecret({}), null);
  assert.equal(cronSecret({ CRON_SECRET: "  " }), null);
  assert.equal(cronSecret({ CRON_SECRET: "too-short" }), null);
  const secret = cronSecret({ CRON_SECRET: "0123456789abcdef0123" });
  assert.equal(secret, "0123456789abcdef0123");
  assert.equal(cronAuthorized(`Bearer ${secret}`, secret), true);
  for (const header of [null, "", secret, `Bearer ${secret}x`, `Bearer ${secret!.slice(1)}`, `Basic ${secret}`, `Bearer  ${secret}`, "Bearer undefined"]) {
    assert.equal(cronAuthorized(header, secret), false, String(header));
  }
  assert.equal(cronAuthorized("Bearer null", null), false, "no secret never authorizes, whatever is sent");
  assert.equal(cronAuthorized("Bearer ", null), false);
});

test("the feature is off unless both Resend variables are set", () => {
  assert.equal(watchConfig({}), null);
  assert.equal(watchConfig({ RESEND_API_KEY: "re_test" }), null);
  assert.equal(watchConfig({ WATCH_FROM_EMAIL: "watch@example.com" }), null);
  assert.equal(watchConfig({ RESEND_API_KEY: " ", WATCH_FROM_EMAIL: "watch@example.com" }), null);
  assert.equal(watchEnabled({}), false);
  assert.deepEqual(watchConfig(ENV), { apiKey: "re_test", from: "DeployDoctor <watch@example.com>" });
  assert.equal(watchEnabled(ENV), true);
});

test("new findings: a new file or problem is new, a moved line or a fixed finding is not", () => {
  const before = results([check("imports", "red", [{ file: "a.ts", line: 3, problem: "Cannot resolve ./x" }]), check("env", "green")]);
  assert.deepEqual(newFindings(before, results([check("imports", "red", [{ file: "a.ts", line: 9, problem: "Cannot resolve ./x" }]), check("env", "green")])), []);
  assert.deepEqual(newFindings(before, results([check("imports", "green", []), check("env", "green")])), []);
  const fresh = newFindings(before, results([
    check("imports", "red", [{ file: "a.ts", problem: "Cannot resolve ./x" }, { file: "b.ts", problem: "Cannot resolve ./x" }, { file: "a.ts", problem: "Cannot resolve ./y" }]),
    check("env", "yellow", [{ file: ".env.example", problem: "API_URL is optional" }]),
  ]));
  assert.deepEqual(fresh.map((item) => [item.checkId, item.status, item.file, item.problem]), [
    ["imports", "red", "b.ts", "Cannot resolve ./x"], ["imports", "red", "a.ts", "Cannot resolve ./y"], ["env", "yellow", ".env.example", "API_URL is optional"],
  ]);
  assert.equal(fresh[0].title, analysisText("en").titles.imports);
});

test("new findings: a failing check without findings is new when it was green or went from yellow to red", () => {
  const before = results([check("next-entry", "green"), check("build-config", "yellow"), check("prisma", "red")]);
  const fresh = newFindings(before, results([check("next-entry", "red"), check("build-config", "red"), check("prisma", "red")]));
  assert.deepEqual(fresh.map((item) => [item.checkId, item.status]), [["next-entry", "red"], ["build-config", "red"]]);
  assert.equal(fresh[0].file, undefined);
  assert.deepEqual(newFindings(before, results([check("next-entry", "green"), check("build-config", "yellow"), check("prisma", "yellow")])), []);
});

test("new findings: a check the previous report did not run never counts as new", () => {
  const before = results([check("imports", "green")]);
  assert.deepEqual(newFindings(before, results([check("imports", "green"), check("secrets", "red", [{ file: "a.ts", problem: "Stripe key" }])])), []);
});

test("the report language comes from its check titles", () => {
  assert.equal(reportLang(results([check("imports", "green")])), "en");
  assert.equal(reportLang(results([check("imports", "green", undefined, "sv")])), "sv");
  assert.equal(reportLang(results([])), null);
});

test("only a scan GitHub cut short is treated as unreliable", () => {
  for (const reason of ["rate_limit", "read_error", "time_limit"]) assert.equal(transientPartial(results([], [reason])), true, reason);
  for (const reason of ["truncated_tree", "file_limit", "file_size"]) assert.equal(transientPartial(results([], [reason])), false, reason);
  assert.equal(transientPartial(results([])), false);
});

test("emails are plain text with the repo, the links and an unsubscribe link, in the report language", () => {
  const confirm = confirmationEmail({ lang: "en", to: "dev@example.com", repo: "acme/shop",
    confirmUrl: "https://dd.test/api/watch/confirm?token=abc", unsubscribeUrl: "https://dd.test/api/watch/unsubscribe?token=u" });
  assert.equal(confirm.to, "dev@example.com");
  assert.match(confirm.subject, /acme\/shop/);
  assert.match(confirm.text, /https:\/\/dd\.test\/api\/watch\/confirm\?token=abc/);
  assert.match(confirm.text, /Unsubscribe: https:\/\/dd\.test\/api\/watch\/unsubscribe\?token=u/);
  assert.equal(confirm.unsubscribeUrl, "https://dd.test/api/watch/unsubscribe?token=u");

  const findings: NewFinding[] = Array.from({ length: 12 }, (_, index) => ({ checkId: "imports", title: "Broken imports", status: index ? "red" : "yellow",
    file: `src/f${index}.ts`, problem: `Cannot resolve ./m${index}` }));
  const alert = alertEmail({ lang: "en", to: "dev@example.com", repo: "acme/shop", findings, reportUrl: "https://dd.test/r/1",
    unsubscribeUrl: "https://dd.test/u", idempotencyKey: "watch-alert/w/r" });
  assert.match(alert.subject, /acme\/shop/);
  assert.match(alert.text, /- \[Review\] Broken imports: src\/f0\.ts: Cannot resolve \.\/m0/);
  assert.match(alert.text, /- \[Fail\] Broken imports: src\/f9\.ts/);
  assert.doesNotMatch(alert.text, /src\/f10\.ts/, "at most ten are listed");
  assert.match(alert.text, /And 2 more in the report\./);
  assert.match(alert.text, /Full report: https:\/\/dd\.test\/r\/1/);
  assert.match(alert.text, /https:\/\/dd\.test\/u$/);
  assert.equal(alert.idempotencyKey, "watch-alert/w/r");

  const sv = alertEmail({ lang: "sv", to: "dev@example.com", repo: "acme/shop", findings: findings.slice(0, 1), reportUrl: "https://dd.test/r/1", unsubscribeUrl: "https://dd.test/u" });
  assert.match(sv.subject, /Nya driftsättningsproblem i acme\/shop/);
  assert.match(sv.text, /\[Granska\]/);
  assert.doesNotMatch(sv.text, /rapporten\.\n/, "no more line for a single finding");
});

test("watch copy exists in both languages with no dashes or quotation marks", () => {
  const keys = Object.keys(messages.en).filter((key) => key.startsWith("watch.")) as Array<keyof typeof messages.en>;
  assert.ok(keys.length >= 30);
  for (const key of keys) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(messages[lang][key], `${lang} ${key}`);
      assert.doesNotMatch(messages[lang][key], /[–—"“”„]/, `${lang} ${key}`);
    }
  }
});

test("nothing is sent, and Resend is never called, when either variable is missing", async () => {
  let calls = 0;
  const fakeFetch = (async () => { calls += 1; return new Response("{}"); }) as typeof fetch;
  const message: WatchEmail = { to: "dev@example.com", subject: "s", text: "t", unsubscribeUrl: "https://dd.test/u" };
  for (const env of [{}, { RESEND_API_KEY: "re_test" }, { WATCH_FROM_EMAIL: "watch@example.com" }]) {
    assert.equal(await sendWatchEmail(message, env, fakeFetch), false);
  }
  assert.equal(calls, 0);
});

test("an email goes to Resend with the key, the sender, List-Unsubscribe and the idempotency key", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const ok = (async (url: string, init: RequestInit) => { requests.push({ url, init }); return new Response('{"id":"e1"}'); }) as unknown as typeof fetch;
  const sent = await sendWatchEmail({ to: "dev@example.com", subject: "Hi", text: "Body", unsubscribeUrl: "https://dd.test/u?token=x", idempotencyKey: "k1" }, ENV, ok);
  assert.equal(sent, true);
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].init.method, "POST");
  const headers = requests[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_test");
  assert.equal(headers["Idempotency-Key"], "k1");
  const body = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(body.to, ["dev@example.com"]);
  assert.equal(body.from, ENV.WATCH_FROM_EMAIL);
  assert.equal(body.text, "Body");
  assert.equal(body.headers["List-Unsubscribe"], "<https://dd.test/u?token=x>");
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

  const failing = (async () => new Response("{}", { status: 422 })) as typeof fetch;
  assert.equal(await sendWatchEmail({ to: "dev@example.com", subject: "s", text: "t", unsubscribeUrl: "u" }, ENV, failing), false);
  const throwing = (async () => { throw new TypeError("network"); }) as typeof fetch;
  assert.equal(await sendWatchEmail({ to: "dev@example.com", subject: "s", text: "t", unsubscribeUrl: "u" }, ENV, throwing), false);
});

/** In-memory stand-ins for the database, GitHub and Resend. */
function fakeWorld(options: { watches: WatchRow[]; reports?: StoredReport[]; scanResults?: ReportResults; pushedAt?: number | null; sendOk?: boolean }) {
  const queue = [...options.watches];
  const reports = new Map((options.reports ?? []).map((report) => [report.id, report]));
  const log = { claims: [] as number[], scans: [] as Array<{ repoUrl: string; lang: string; checks?: string[] }>, saved: [] as StoredReport[],
    sent: [] as WatchEmail[], baselines: [] as Array<[string, string]> };
  let saved = 0;
  const deps: WatchCronDeps = {
    claim: async (limit) => { log.claims.push(limit); return queue.splice(0, limit); },
    loadReport: async (id) => reports.get(id) ?? null,
    pushedAt: async () => options.pushedAt === undefined ? Date.parse("2026-10-10T00:00:00Z") : options.pushedAt,
    scan: async (repoUrl, scanOptions) => {
      log.scans.push({ repoUrl, lang: scanOptions.lang, checks: scanOptions.checks });
      return { canonicalUrl: repoUrl, results: options.scanResults ?? results([]) };
    },
    save: async (repoUrl, scanned) => {
      saved += 1;
      const report = { id: `00000000-0000-4000-8000-${String(saved).padStart(12, "0")}`, repo_url: repoUrl, results: scanned, created_at: "2026-10-17T06:00:00.000Z" };
      log.saved.push(report);
      return report;
    },
    setBaseline: async (watchId, reportId) => { log.baselines.push([watchId, reportId]); },
    send: async (message) => { log.sent.push(message); return options.sendOk ?? true; },
    isRateLimit: (error) => error instanceof Error && error.message === "rate limit",
    unsubscribeUrl: (watchId) => `https://dd.test/api/watch/unsubscribe?token=${unsubscribeToken(watchId)}`,
    siteUrl: "https://dd.test",
  };
  return { deps, log };
}

const BASELINE: StoredReport = { id: "4e515536-d2b3-474f-884e-b4498baa878f", repo_url: "https://github.com/acme/shop", created_at: "2026-10-01T00:00:00.000Z",
  results: results([check("imports", "red", [{ file: "a.ts", problem: "Cannot resolve ./x" }]), check("env", "green")]) };
const watch = (id: string, last: string | null = BASELINE.id, repo = "https://github.com/acme/shop"): WatchRow =>
  ({ id: `00000000-0000-4000-8000-0000000000${id}`, email: `${id}@example.com`, repo_url: repo, last_report_id: last });

test("cron: a new finding emails the subscriber once, with the new report link, and moves the baseline", async () => {
  const scanned = results([check("imports", "red", [{ file: "a.ts", problem: "Cannot resolve ./x" }, { file: "b.ts", problem: "Cannot resolve ./z" }]), check("env", "green")]);
  const { deps, log } = fakeWorld({ watches: [watch("01")], reports: [BASELINE], scanResults: scanned });
  const summary = await runWatchCron(deps);
  assert.equal(summary.alerted, 1);
  assert.equal(log.sent.length, 1);
  assert.equal(log.sent[0].to, "01@example.com");
  assert.match(log.sent[0].text, /b\.ts: Cannot resolve \.\/z/);
  assert.doesNotMatch(log.sent[0].text, /a\.ts/, "only what is new");
  assert.match(log.sent[0].text, new RegExp(`https://dd\\.test/r/${log.saved[0].id}`));
  assert.equal(verifyUnsubscribeToken(new URL(log.sent[0].unsubscribeUrl).searchParams.get("token")), watch("01").id);
  assert.equal(log.sent[0].idempotencyKey, `watch-alert/${watch("01").id}/${log.saved[0].id}`);
  assert.deepEqual(log.baselines, [[watch("01").id, log.saved[0].id]]);
});

test("cron: nothing new, no baseline yet, or no push since the baseline sends nothing", async () => {
  const same = fakeWorld({ watches: [watch("01")], reports: [BASELINE], scanResults: BASELINE.results });
  assert.equal((await runWatchCron(same.deps)).quiet, 1);
  assert.equal(same.log.sent.length, 0);
  assert.equal(same.log.baselines.length, 1);

  const first = fakeWorld({ watches: [watch("02", null)], scanResults: results([check("imports", "red", [{ file: "a.ts", problem: "x" }])]) });
  assert.equal((await runWatchCron(first.deps)).baseline, 1);
  assert.equal(first.log.sent.length, 0, "the first scan only sets the baseline");
  assert.equal(first.log.baselines.length, 1);

  const idle = fakeWorld({ watches: [watch("03")], reports: [BASELINE], pushedAt: Date.parse("2026-09-30T00:00:00Z") });
  assert.equal((await runWatchCron(idle.deps)).unchanged, 1);
  assert.equal(idle.log.scans.length, 0, "an untouched repository is not rescanned");
  assert.equal(idle.log.sent.length, 0);
});

test("cron: a failed send keeps the old baseline so the alert is retried", async () => {
  const scanned = results([check("imports", "red", [{ file: "c.ts", problem: "new" }]), check("env", "green")]);
  const { deps, log } = fakeWorld({ watches: [watch("01")], reports: [BASELINE], scanResults: scanned, sendOk: false });
  const summary = await runWatchCron(deps);
  assert.equal(summary.send_failed, 1);
  assert.deepEqual(log.baselines, []);
});

test("cron: when Resend is not configured the job sends nothing", async () => {
  let calls = 0;
  const fakeFetch = (async () => { calls += 1; return new Response("{}"); }) as typeof fetch;
  const scanned = results([check("imports", "red", [{ file: "c.ts", problem: "new" }]), check("env", "green")]);
  const { deps, log } = fakeWorld({ watches: [watch("01")], reports: [BASELINE], scanResults: scanned });
  deps.send = (message) => sendWatchEmail(message, {}, fakeFetch);
  const summary = await runWatchCron(deps);
  assert.equal(calls, 0);
  assert.equal(summary.alerted, 0);
  assert.deepEqual(log.baselines, []);
});

test("cron: a scan GitHub cut short is not saved or compared, and a rate limit stops the run", async () => {
  const { deps, log } = fakeWorld({ watches: [watch("01"), watch("02", BASELINE.id, "https://github.com/acme/other"), watch("03")],
    reports: [BASELINE], scanResults: results([check("imports", "red", [{ file: "new.ts", problem: "new" }])], ["rate_limit"]) });
  const summary = await runWatchCron(deps, { batch: 2 });
  assert.equal(summary.partial, 2);
  assert.equal(summary.stopped, true);
  assert.equal(summary.claimed, 2, "no further batch after GitHub said stop");
  assert.equal(log.saved.length, 0);
  assert.equal(log.sent.length, 0);

  const thrown = fakeWorld({ watches: [watch("01"), watch("02")], reports: [BASELINE] });
  thrown.deps.scan = async () => { throw new Error("rate limit"); };
  const result = await runWatchCron(thrown.deps, { batch: 1 });
  assert.equal(result.failed, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.claimed, 1);
});

test("cron: one scan per repository per run, in the baseline's language and categories, at most 40 watches", async () => {
  const svBaseline: StoredReport = { ...BASELINE, results: { ...results([check("imports", "red", [{ file: "a.ts", problem: "x" }], "sv")]),
    scope: { scanned: ["next", "env"], ignored: ["supabase", "prisma", "vercel"] } } };
  const many = Array.from({ length: 45 }, (_, index) => watch(String(index).padStart(2, "0")));
  const { deps, log } = fakeWorld({ watches: many, reports: [svBaseline], scanResults: svBaseline.results });
  const summary = await runWatchCron(deps, { batch: 8 });
  assert.equal(summary.claimed, 40);
  assert.ok(log.claims.every((limit) => limit <= 8));
  assert.equal(log.claims.reduce((sum, limit) => sum + limit, 0), 40);
  assert.equal(log.scans.length, 1);
  assert.deepEqual(log.scans[0], { repoUrl: "https://github.com/acme/shop", lang: "sv", checks: ["next", "env"] });
  assert.equal(summary.quiet, 40);
});

test("cron: the job stops taking watches when its time budget is spent", async () => {
  let clock = 0;
  const { deps } = fakeWorld({ watches: Array.from({ length: 10 }, (_, index) => watch(String(index).padStart(2, "0"))), reports: [BASELINE],
    scanResults: BASELINE.results });
  deps.now = () => clock;
  const claim = deps.claim;
  deps.claim = async (limit) => { clock += 100_000; return claim(limit); };
  const summary = await runWatchCron(deps, { batch: 2, budgetMs: 200_000 });
  assert.equal(summary.claimed, 4);
});

test("every watch route answers 503 before it touches the database or sends anything when Resend is not configured", () => {
  // The routes import server-only modules, so this reads them: each handler's first check is the configuration.
  for (const file of ["src/app/api/watch/route.ts", "src/app/api/watch/confirm/route.ts", "src/app/api/watch/unsubscribe/route.ts", "src/app/api/cron/watch/route.ts"]) {
    const handlers = readFileSync(file, "utf8").split(/^export async function /m).slice(1);
    assert.ok(handlers.length >= 1, file);
    for (const handler of handlers) {
      const firstIf = /^\s*if \((.+)$/m.exec(handler)?.[1] ?? "";
      assert.match(firstIf, /watchConfig\(\)\).*status: 503/, `${file}: ${handler.slice(0, 20)}`);
      assert.ok(handler.indexOf("watchConfig()") < Math.min(...["db(", "rpc(", "sendWatchEmail(", "runWatchCron("].map((call) => {
        const at = handler.indexOf(call);
        return at < 0 ? Infinity : at;
      })), file);
    }
  }
});

test("opening a confirm or unsubscribe link changes nothing: mail scanners open links, so only the page button acts", () => {
  for (const file of ["src/app/api/watch/confirm/route.ts", "src/app/api/watch/unsubscribe/route.ts"]) {
    const source = readFileSync(file, "utf8");
    const get = source.split(/^export async function /m).find((handler) => handler.startsWith("GET")) ?? "";
    assert.ok(get, file);
    for (const call of ["db(", "unsubscribe(", "PATCH"]) assert.equal(get.includes(call), false, `${file} GET must not call ${call}`);
    assert.match(get, /Response\.redirect/, file);
  }
  const confirm = readFileSync("src/app/api/watch/confirm/route.ts", "utf8").split(/^export async function /m).find((h) => h.startsWith("POST")) ?? "";
  assert.match(confirm, /sameOrigin\(request\)/, "the confirm button only works from our own page");
});

test("vercel.json runs the watch job once a day, which the Hobby plan allows, within the Hobby duration limit", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  const job = config.crons.find((item) => item.path === "/api/cron/watch");
  assert.ok(job);
  const schedule = parseVercelCron(job.schedule);
  assert.ok(schedule && !("issue" in schedule), job.schedule);
  assert.equal(runsMoreThanOnceADay(schedule), false);
  const route = readFileSync("src/app/api/cron/watch/route.ts", "utf8");
  const maxDuration = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
  assert.ok(maxDuration > 60 && maxDuration <= 300, String(maxDuration));
});

test("the watch tables have RLS on and are granted to the service role only", () => {
  const files = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()
    .map((name) => ({ file: `supabase/migrations/${name}`, source: readFileSync(`supabase/migrations/${name}`, "utf8") }));
  // DeployDoctor's own Supabase check: RLS on, and a grant so the server's service role can reach the table.
  const tables = Object.fromEntries(auditMigrations(files).tables.map((table) => [table.name, table]));
  for (const name of ["repo_watches", "watch_request_limits"]) {
    assert.ok(tables[name], name);
    assert.equal(tables[name].rls, true, name);
    assert.equal(tables[name].granted, true, name);
  }
  const sql = files.find((item) => item.file.endsWith("_repo_watches.sql"))!.source;
  assert.match(sql, /revoke all on table public\.repo_watches, public\.watch_request_limits from public, anon, authenticated;/);
  assert.match(sql, /from public, anon, authenticated;\s*grant execute on function [^;]+ to service_role;\s*$/);
  for (const grant of sql.match(/\bgrant [^;]+;/gi) ?? []) assert.match(grant, /to service_role;$/, grant);
  assert.doesNotMatch(sql, /create policy/i, "no policies: only the service role, which bypasses RLS, reads the tables");
});
