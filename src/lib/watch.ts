import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { analysisText } from "@/lib/analysis-text";
import { t, type Lang } from "@/lib/i18n";
import { digest } from "@/lib/session-token";
import type { Category, CheckId, ReportResults, StoredReport } from "@/types/report";

/**
 * Watch this repo: a daily rescan of a public repository that emails the subscriber when something new breaks.
 * Email goes through the Resend REST API. Without RESEND_API_KEY and WATCH_FROM_EMAIL the feature is hidden,
 * its routes answer 503 and nothing is ever sent.
 */
export type WatchConfig = { apiKey: string; from: string };
type Env = Record<string, string | undefined>;

export function watchConfig(env: Env = process.env): WatchConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.WATCH_FROM_EMAIL?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

export function watchEnabled(env: Env = process.env): boolean {
  return watchConfig(env) !== null;
}

/** Confirmation tokens are 32 random bytes; only their SHA-256 is stored, so a database read cannot confirm a watch. */
export function hashWatchToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newWatchToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashWatchToken(token) };
}

export function isWatchToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * The unsubscribe link in every email: the watch id signed under its own namespace. The daily job has no
 * confirmation token to put in an alert (only its hash is stored), and this link must keep working for good.
 */
export function unsubscribeToken(watchId: string): string {
  return `${watchId}.${digest(`watch-unsubscribe:${watchId}`)}`;
}

/** The watch id when the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return null;
  try {
    const expected = Buffer.from(digest(`watch-unsubscribe:${match[1]}`), "hex");
    return timingSafeEqual(Buffer.from(match[2], "hex"), expected) ? match[1] : null;
  } catch {
    return null;
  }
}

/** A plain address in lower case, or null. Rejects anything that could read as more than one recipient. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email)
    ? email : null;
}

/** CRON_SECRET when it is long enough to guard the job; Vercel sends it as a Bearer token on every cron call. */
export function cronSecret(env: Env = process.env): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function cronAuthorized(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The language a report was written in, read from its check titles, or null for a report without checks. */
export function reportLang(results: ReportResults): Lang | null {
  for (const lang of ["sv", "en"] as const) {
    const own = new Set(Object.values(analysisText(lang).titles));
    const other = new Set(Object.values(analysisText(lang === "sv" ? "en" : "sv").titles));
    if (results.checks.some((check) => own.has(check.title) && !other.has(check.title))) return lang;
  }
  return null;
}

/** GitHub stopped the scan or a file could not be read in time; tomorrow's scan may see more, so it proves nothing. */
export function transientPartial(results: ReportResults): boolean {
  return (results.scan.reasons ?? []).some((reason) => reason === "rate_limit" || reason === "read_error" || reason === "time_limit");
}

export type NewFinding = { checkId: CheckId; title: string; status: "red" | "yellow"; file?: string; problem: string };

function problemsOf(results: ReportResults): Map<string, NewFinding> {
  const problems = new Map<string, NewFinding>();
  for (const check of results.checks) {
    if (check.status === "green") continue;
    const base = { checkId: check.id, title: check.title, status: check.status };
    // Line numbers move with every edit above them, so a finding is its check, file and problem.
    for (const finding of check.findings ?? []) {
      problems.set(`${check.id}\n${finding.file}\n${finding.problem}`, { ...base, file: finding.file, problem: finding.problem });
    }
    if (!check.findings?.length) problems.set(`${check.id}\n${check.status}`, { ...base, problem: check.explanation });
  }
  return problems;
}

/**
 * Red or yellow findings in the new report that the previous one did not have, by check id, file and problem.
 * A failing check without findings is new when it was green before or went from yellow to red. Checks the
 * previous report did not run are skipped, so a check DeployDoctor adds later never reads as a new break.
 */
export function newFindings(previous: ReportResults, next: ReportResults): NewFinding[] {
  const before = problemsOf(previous);
  const statusBefore = new Map(previous.checks.map((check) => [check.id, check.status]));
  return [...problemsOf(next)].filter(([key, item]) => {
    const was = statusBefore.get(item.checkId);
    if (!was || before.has(key)) return false;
    if (item.file !== undefined) return true;
    return was === "green" || (was === "yellow" && item.status === "red");
  }).map(([, item]) => item);
}

export type WatchEmail = { to: string; subject: string; text: string; unsubscribeUrl: string; idempotencyKey?: string };

export function confirmationEmail(input: { lang: Lang; to: string; repo: string; confirmUrl: string; unsubscribeUrl: string }): WatchEmail {
  const { lang, repo } = input;
  return {
    to: input.to,
    subject: t(lang, "watch.mail.confirmSubject", { repo }),
    text: [t(lang, "watch.mail.confirmIntro", { repo }), "", t(lang, "watch.mail.confirmCta"), input.confirmUrl, "",
      t(lang, "watch.mail.confirmIgnore"), "", t(lang, "watch.mail.unsubscribe", { url: input.unsubscribeUrl })].join("\n"),
    unsubscribeUrl: input.unsubscribeUrl,
  };
}

const MAX_LISTED = 10;

export function alertEmail(input: { lang: Lang; to: string; repo: string; findings: NewFinding[]; reportUrl: string;
  unsubscribeUrl: string; idempotencyKey?: string }): WatchEmail {
  const { lang, repo } = input;
  const items = input.findings.slice(0, MAX_LISTED).map((item) =>
    `- [${t(lang, item.status === "red" ? "report.fail" : "report.review")}] ${item.title}: ${item.file ? `${item.file}: ` : ""}${item.problem}`);
  const more = input.findings.length - items.length;
  return {
    to: input.to,
    subject: t(lang, "watch.mail.alertSubject", { repo }),
    text: [t(lang, "watch.mail.alertIntro", { repo }), "", ...items, ...(more > 0 ? [t(lang, "watch.mail.more", { n: more })] : []), "",
      t(lang, "watch.mail.report", { url: input.reportUrl }), "", t(lang, "watch.mail.footer", { repo, url: input.unsubscribeUrl })].join("\n"),
    unsubscribeUrl: input.unsubscribeUrl,
    idempotencyKey: input.idempotencyKey,
  };
}

/** Sends one plain-text email through Resend. Returns false, without a request, when the feature is not configured. */
export async function sendWatchEmail(message: WatchEmail, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const config = watchConfig(env);
  if (!config) return false;
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: config.from, to: [message.to], subject: message.subject, text: message.text,
        // One click from the mail app itself (RFC 8058), next to the link in the text.
        headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.error("Watch email failed", response.status);
    return response.ok;
  } catch (error) {
    console.error("Watch email failed", error instanceof Error ? error.name : "unknown");
    return false;
  }
}

export type WatchRow = { id: string; email: string; repo_url: string; last_report_id: string | null };
export type WatchOutcome = "alerted" | "quiet" | "baseline" | "unchanged" | "partial" | "send_failed" | "failed";

/** What the daily job needs from the outside world, passed in so the job itself can be tested without it. */
export type WatchCronDeps = {
  claim: (limit: number) => Promise<WatchRow[]>;
  loadReport: (id: string) => Promise<StoredReport | null>;
  /** When the repository last got a push, in ms, or null when GitHub does not say. */
  pushedAt: (repoUrl: string) => Promise<number | null>;
  scan: (repoUrl: string, options: { checks?: Category[]; lang: Lang }) => Promise<{ canonicalUrl: string; results: ReportResults }>;
  save: (repoUrl: string, results: ReportResults) => Promise<StoredReport>;
  setBaseline: (watchId: string, reportId: string) => Promise<void>;
  send: (message: WatchEmail) => Promise<boolean>;
  isRateLimit: (error: unknown) => boolean;
  unsubscribeUrl: (watchId: string) => string;
  siteUrl: string;
  now?: () => number;
};

export type WatchCronSummary = { claimed: number; stopped: boolean } & Record<WatchOutcome, number>;

/**
 * Takes up to `max` confirmed watches in small batches, rescans each repository once per run and emails a
 * subscriber only when the new report has findings the previous one did not. The previous report stays the
 * baseline until an alert is delivered, so a failed send is retried with the next scan.
 */
export async function runWatchCron(deps: WatchCronDeps, options: { max?: number; batch?: number; budgetMs?: number } = {}): Promise<WatchCronSummary> {
  const { max = 40, batch = 4, budgetMs = 200_000 } = options;
  const now = deps.now ?? Date.now;
  const started = now();
  const summary: WatchCronSummary = { claimed: 0, stopped: false, alerted: 0, quiet: 0, baseline: 0, unchanged: 0, partial: 0, send_failed: 0, failed: 0 };
  const pushes = new Map<string, Promise<number | null>>();
  const scans = new Map<string, Promise<StoredReport | null>>();

  async function check(watch: WatchRow): Promise<WatchOutcome> {
    const previous = watch.last_report_id ? await deps.loadReport(watch.last_report_id) : null;
    const repoKey = watch.repo_url.toLowerCase();
    if (!pushes.has(repoKey)) pushes.set(repoKey, deps.pushedAt(watch.repo_url));
    const pushed = await pushes.get(repoKey)!;
    // Nothing was pushed since the baseline was scanned, so nothing in the code can have broken.
    if (previous && pushed !== null && pushed <= Date.parse(previous.created_at)) return "unchanged";

    // Same language and categories as the baseline, so findings compare word for word.
    const lang = (previous && reportLang(previous.results)) || "en";
    const checks = previous?.results.scope?.scanned;
    const scanKey = `${repoKey}|${lang}|${checks?.join(",") ?? "all"}`;
    if (!scans.has(scanKey)) {
      scans.set(scanKey, deps.scan(watch.repo_url, { checks, lang }).then(({ canonicalUrl, results }) => {
        if ((results.scan.reasons ?? []).includes("rate_limit")) summary.stopped = true;
        return transientPartial(results) ? null : deps.save(canonicalUrl, results);
      }));
    }
    const report = await scans.get(scanKey)!;
    if (!report) return "partial";
    if (!previous) {
      await deps.setBaseline(watch.id, report.id);
      return "baseline";
    }
    const fresh = newFindings(previous.results, report.results);
    if (!fresh.length) {
      await deps.setBaseline(watch.id, report.id);
      return "quiet";
    }
    const repo = `${report.results.repository.owner}/${report.results.repository.name}`;
    const sent = await deps.send(alertEmail({
      lang, to: watch.email, repo, findings: fresh, reportUrl: `${deps.siteUrl}/r/${report.id}`,
      unsubscribeUrl: deps.unsubscribeUrl(watch.id), idempotencyKey: `watch-alert/${watch.id}/${report.id}`,
    }));
    if (!sent) return "send_failed";
    await deps.setBaseline(watch.id, report.id);
    return "alerted";
  }

  while (summary.claimed < max && !summary.stopped && now() - started < budgetMs) {
    const wanted = Math.min(batch, max - summary.claimed);
    const rows = await deps.claim(wanted);
    summary.claimed += rows.length;
    const outcomes = await Promise.all(rows.map((watch) => check(watch).catch((error: unknown) => {
      if (deps.isRateLimit(error)) summary.stopped = true;
      console.error("Watch check failed", error instanceof Error ? error.name : "unknown");
      return "failed" as const;
    })));
    for (const outcome of outcomes) summary[outcome] += 1;
    if (rows.length < wanted) break;
  }
  return summary;
}
