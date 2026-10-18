import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyFixes, FixFirst, IgnoreProvider, IssueCard, ScoreCard, WhenOpenRed } from "@/components/report-ignore";
import { getPreviousReport, getReport } from "@/lib/reports";
import type { Category, CheckId, CheckStatus, ReportResults, StoredReport } from "@/types/report";
import { diffReports, fixFirstItems, severityOf, showsLocalWhy, type ReportDiff } from "@/lib/report-insights";
import { SinceLastScan } from "@/components/report-since";
import { freeFixParts } from "@/lib/fix-instructions";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { SiteNav } from "@/components/site-nav";
import { CopyFixesButton } from "@/components/copy-fixes-button";
import { CopyTextButton } from "@/components/copy-text-button";
import { SolvedPrompt } from "@/components/solved-prompt";
import { WatchBox } from "@/components/watch-box";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { PatchOffer } from "@/components/patch-offer";
import { SITE_URL } from "@/lib/site";
import { getT } from "@/lib/lang";
import { FIX_SERVICE_ENABLED } from "@/lib/fix-service";
import { dateLocale, type MessageKey } from "@/lib/i18n";
import { overallLabel } from "@/lib/report-summary";
import { activePlan, customerSession } from "@/lib/access";
import { frameworkName } from "@/lib/stack";

const statusLabelKeys: Record<CheckStatus, MessageKey> = {
  red: "report.fail",
  yellow: "report.review",
  green: "report.pass",
};

/** Official docs for each failure class, so a report never asks you to take its word for it. */
const docsFor: Record<CheckId, string> = {
  "next-entry": "https://nextjs.org/docs/app/getting-started/project-structure",
  imports: "https://vercel.com/guides/how-do-i-resolve-a-module-not-found-error",
  "server-libs": "https://nextjs.org/docs/app/api-reference/edge",
  "build-config": "https://vercel.com/docs/deployments/configure-a-build",
  dependencies: "https://vercel.com/docs/package-managers",
  env: "https://vercel.com/docs/environment-variables",
  secrets: "https://vercel.com/docs/environment-variables/sensitive-environment-variables",
  supabase: "https://supabase.com/docs/guides/auth/server-side/nextjs",
  prisma: "https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel",
};
const partialReasonKeys = ["truncated_tree", "file_limit", "file_size", "time_limit", "rate_limit", "read_error"] as const;

/** A ready-to-paste GitHub issue for one failed check. */
function issueMarkdown(title: string, explanation: string, evidence: string[], fix: string, link: string): string {
  const lines = [`## ${title}`, "", explanation, ""];
  if (evidence.length) lines.push("**Evidence**", "", ...evidence.map((item) => `- ${item}`), "");
  lines.push("**Suggested fix**", "", fix, "", `Found by DeployDoctor: ${link}`);
  return lines.join("\n");
}

/** The comparison with the previous scan, or null when there is none or its saved results cannot be read. */
function sinceDiff(previous: StoredReport | null, current: ReportResults): ReportDiff | null {
  // A scan that found no Next.js app at the root has nothing to compare with.
  if (!previous || previous.results.nextApp === "none" || previous.results.nextApp === "nested") return null;
  try {
    return diffReports(previous.results, current);
  } catch {
    return null;
  }
}

const statusSymbols: Record<CheckStatus, string> = {
  red: "×",
  yellow: "!",
  green: "✓",
};

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getT();
  const report = await getReport(id);
  if (!report) return { title: t("report.notFoundTitle") };
  const title = t("report.title", { repo: `${report.results.repository.owner}/${report.results.repository.name}` });
  const description = t("report.metaDesc", { n: report.results.summary.red });
  // The image comes from opengraph-image.tsx next to this file; the title and url must be per report too,
  // otherwise a shared link unfurls as the home page.
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { type: "article", siteName: "DeployDoctor", url: `/r/${id}`, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ReportPage({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const { lang, t } = await getT();
  const report = await getReport(id);
  if (!report) notFound();
  // Older reports have no nextApp field and keep their old look.
  const notNext = report.results.nextApp === "none" || report.results.nextApp === "nested";
  const [plan, previous] = await Promise.all([
    // Someone with an active pass is never asked to buy another one.
    customerSession().then((session) => activePlan(session).catch(() => null)),
    // The one extra query of a view; when it fails the page only loses the since-the-previous-scan section.
    notNext ? null : getPreviousReport(report).catch(() => null),
  ]);

  const { results } = report;
  const repoName = `${results.repository.owner}/${results.repository.name}`;
  const parts = freeFixParts(report, lang);
  const checkStates = results.checks.map(({ id, status }) => ({ id, status }));
  // Reports saved before category filtering have no scope: everything they contain was scanned.
  const present = new Set<Category>(results.checks.map(categoryOf));
  const scanned = results.scope?.scanned ?? CATEGORIES.filter((category) => present.has(category));
  const ignoredCategories = results.scope?.ignored ?? [];

  const status = report.is_private ? t("report.private") : t("report.savedFree");
  const rescanHref = `/?repo=${encodeURIComponent(`${results.repository.owner}/${results.repository.name}`)}`;
  const badgeMarkdown = `[![DeployDoctor](${SITE_URL}/r/${id}/badge)](${SITE_URL}/r/${id})`;
  // A root app on another framework the scan knows still gets real results, so it keeps the normal headline.
  const otherStack = results.nextApp === "none" ? results.stack?.framework : undefined;
  const neutral = notNext && !otherStack;
  const overall = overallLabel(results.summary, lang, { notNext: neutral });
  const fixFirst = neutral ? [] : fixFirstItems(results.checks);
  const since = sinceDiff(previous, results);
  return (
    <main className="site-shell report-page">
      <SiteNav note={<><span className="status-dot" /> {status}</>} />

      <IgnoreProvider reportId={id}>
      <header className="report-header">
        <p className="report-status-mobile"><span className="status-dot" /> {status}</p>
        <Link className="back-link" href="/">
          {t("report.back")}
        </Link>
        {notNext && (
          <div className="not-next-notice" role="note">
            {/* A root app on another framework the scan knows: say what is still checked, from the categories scanned. */}
            <strong>{otherStack ? t("report.otherStackNotice", { stack: frameworkName(otherStack) }) : t("report.notNextNotice")}</strong>
            {otherStack && scanned.includes("vercel") && <> {t("report.otherStackVercel")}</>}
            {otherStack && scanned.includes("env") && <> {t("report.otherStackEnv")}</>}
            {results.nextApp === "nested" && <> {t("report.notNextNested")}</>}
          </div>
        )}
        <div className="report-heading-row">
          <div>
            <p className="section-kicker">{t("report.kicker")}</p>
            <h1>{repoName}</h1>
          </div>
          <ScoreCard checks={checkStates} notNext={neutral} />
        </div>
        {previous && since && <SinceLastScan diff={since} previous={previous} lang={lang} />}
        <FixFirst items={fixFirst} />
        <div className="report-meta">
          <a className="report-repo" href={report.repo_url} target="_blank" rel="noreferrer">
            {report.repo_url} ↗
          </a>
          <span>{t("report.branch", { branch: results.repository.defaultBranch })}</span>
          <span>{t("report.scannedFiles", { read: results.scan.sourceFilesRead, found: results.scan.sourceFilesFound })}</span>
          <span>{new Date(report.created_at).toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</span>
          <Link className="rescan-link" href={rescanHref}>{t("report.scanAgain")} ↻</Link>
        </div>
        <p className="scope-line">
          <strong>{t("report.scanned")}</strong> {scanned.map((category) => t(`cat.${category}`)).join(", ") || "—"}
          {ignoredCategories.length > 0 && <> | <strong>{t("report.ignored")}</strong> {ignoredCategories.map((category) => t(`cat.${category}`)).join(", ")}</>}
        </p>
        {results.scan.partial && (
          <aside className="partial-notice" role="note">
            <strong>{t("report.partialTitle")}</strong>
            <ul>
              {(results.scan.reasons ?? []).map((reason) => (
                <li key={reason}>{(partialReasonKeys as readonly string[]).includes(reason) ? t(`report.partial.${reason as typeof partialReasonKeys[number]}`) : reason}</li>
              ))}
            </ul>
            <p>{t("report.partialNote")}</p>
          </aside>
        )}
      </header>

      <WatchBox reportId={id} repo={repoName} isPrivate={report.is_private} />

      <section className="results-list" id="checks" aria-label="Deployment checks">
        {scanned.map((category) => {
          const group = results.checks.filter((check) => categoryOf(check) === category);
          if (!group.length) return null;
          return (
            <div className="check-group" key={category}>
              <p className="section-kicker group-title">{t(`cat.${category}`).toUpperCase()}</p>
              {group.map((check) => (
                <IssueCard key={check.id} id={check.id} title={check.title} status={check.status}
                  symbol={statusSymbols[check.status]} label={t(statusLabelKeys[check.status])}>
                  <span className="result-number">{t("report.check")} {String(results.checks.indexOf(check) + 1).padStart(2, "0")}</span>
                  {check.status === "red" && <span className={`severity is-${severityOf[check.id] ?? "runtime"}`}>{t(`report.severity.${severityOf[check.id] ?? "runtime"}`)}</span>}
                  {check.status === "yellow" && <span className="severity is-review">{t("report.severity.review")}</span>}
                  <h2>{check.title}</h2>
                  <p>{check.explanation}</p>
                  {showsLocalWhy(check) && (
                    <div className="local-why"><strong>{t("report.localWhy")}</strong> {t(`report.localWhy.${check.id}`)}</div>
                  )}
                  {check.evidence.length ? (
                    <ul className="evidence-list" aria-label={t("report.evidence")}>
                      {check.evidence.map((item) => (
                        <li key={item}>↳ {item}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="fix-box">
                    <strong>{t("report.suggested")}</strong> {check.fix}
                  </div>
                  {check.suggestedFile?.content ? (
                    <div className="suggested-file">
                      <div className="suggested-file-head">
                        <strong>{t("report.completeFile", { path: check.suggestedFile.path })}</strong>
                        <CopyFixesButton instructions={check.suggestedFile.content} file />
                      </div>
                      <pre><code>{check.suggestedFile.content}</code></pre>
                    </div>
                  ) : null}
                  {check.status !== "green" && (
                    <div className="card-links">
                      {docsFor[check.id] && <a href={docsFor[check.id]} target="_blank" rel="noreferrer">{t("report.docsLink")} ↗</a>}
                      {check.status === "red" && (
                        <CopyTextButton
                          text={issueMarkdown(check.title, check.explanation, check.evidence, check.fix, `${SITE_URL}/r/${id}#check-${check.id}`)}
                          label={t("report.copyIssue")} copiedLabel={t("report.copied")} />
                      )}
                    </div>
                  )}
                  {/* Letter-case findings are the ones without a `git add` command; only those can be patched. */}
                  {check.id === "imports" && check.status === "red" && !report.is_private
                    && check.findings?.some((finding) => !finding.command) && <PatchOffer reportId={id} />}
                  {FIX_SERVICE_ENABLED && check.status === "red" && <div className="repair-cta"><p>{t("report.fixCta")}</p>
                    <Link href={`/checkout?plan=fix-one&report=${id}&check=${check.id}`}>{t("report.fixOne")}</Link>
                    <Link href={`/checkout?plan=fix-all&report=${id}`}>{t("report.fixAll")}</Link>
                  </div>}
                </IssueCard>
              ))}
            </div>
          );
        })}
      </section>

      <SolvedPrompt kind="report" target={id} repo={report.repo_url} />

      <section className="report-actions" aria-labelledby="action-heading">
        <div>
          <h2 id="action-heading">{t("report.actionsTitle")}</h2>
          <p>{FIX_SERVICE_ENABLED ? t("report.actionsBody") : t("report.actionsBodyFree")}</p>
        </div>
        <div className="action-buttons">
          <CopyFixes parts={parts} />
          {!plan && <ScanCheckoutButton plan="day" style={{ background: "transparent" }} context={report.repo_url}>{t("report.dayCta")}</ScanCheckoutButton>}
          {FIX_SERVICE_ENABLED && <WhenOpenRed checks={checkStates}>
            <Link className="cta-button" href={`/checkout?plan=fix-all&report=${id}`}>
              {t("report.fixAll")}
            </Link>
          </WhenOpenRed>}
        </div>
      </section>


      {!report.is_private && (
        <section className="badge-section" aria-labelledby="badge-heading">
          <div>
            <h2 id="badge-heading">{t("report.badgeTitle")}</h2>
            <p>{t("report.badgeBody")}</p>
          </div>
          <div className="badge-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/r/${id}/badge`} alt={`DeployDoctor: ${overall}`} height={20} />
            <code>{badgeMarkdown}</code>
            <CopyTextButton text={badgeMarkdown} label={t("report.badgeCopy")} copiedLabel={t("report.badgeCopied")} />
          </div>
        </section>
      )}
      </IgnoreProvider>
    </main>
  );
}
