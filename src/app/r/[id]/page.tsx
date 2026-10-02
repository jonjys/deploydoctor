import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyFixes, IgnoreProvider, IssueCard, ScoreCard, WhenOpenRed } from "@/components/report-ignore";
import { getReport } from "@/lib/reports";
import type { Category, CheckStatus } from "@/types/report";
import { freeFixParts } from "@/lib/fix-instructions";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { SiteNav } from "@/components/site-nav";
import { CopyFixesButton } from "@/components/copy-fixes-button";
import { getT } from "@/lib/lang";
import { dateLocale, type MessageKey } from "@/lib/i18n";

const statusLabelKeys: Record<CheckStatus, MessageKey> = {
  red: "report.fail",
  yellow: "report.review",
  green: "report.pass",
};

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
  return {
    title: t("report.title", { repo: `${report.results.repository.owner}/${report.results.repository.name}` }),
    description: t("report.metaDesc", { n: report.results.summary.red }),
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const { lang, t } = await getT();
  const report = await getReport(id);
  if (!report) notFound();

  const { results } = report;
  const repoName = `${results.repository.owner}/${results.repository.name}`;
  const parts = freeFixParts(report, lang);
  const checkStates = results.checks.map(({ id, status }) => ({ id, status }));
  // Reports saved before category filtering have no scope: everything they contain was scanned.
  const present = new Set<Category>(results.checks.map(categoryOf));
  const scanned = results.scope?.scanned ?? CATEGORIES.filter((category) => present.has(category));
  const ignoredCategories = results.scope?.ignored ?? [];

  const status = report.is_private ? t("report.private") : t("report.savedFree");
  // Older reports have no nextApp field and keep their old look.
  const notNext = results.nextApp === "none" || results.nextApp === "nested";
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
            <strong>{t("report.notNextNotice")}</strong>
            {results.nextApp === "nested" && <> {t("report.notNextNested")}</>}
          </div>
        )}
        <div className="report-heading-row">
          <div>
            <p className="section-kicker">{t("report.kicker")}</p>
            <h1>{repoName}</h1>
          </div>
          <ScoreCard checks={checkStates} notNext={notNext} />
        </div>
        <div className="report-meta">
          <a className="report-repo" href={report.repo_url} target="_blank" rel="noreferrer">
            {report.repo_url} ↗
          </a>
          <span>{t("report.branch", { branch: results.repository.defaultBranch })}</span>
          <span>{t("report.scannedFiles", { read: results.scan.sourceFilesRead, found: results.scan.sourceFilesFound })}</span>
          <span>{new Date(report.created_at).toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</span>
        </div>
        <p className="scope-line">
          <strong>{t("report.scanned")}</strong> {scanned.map((category) => t(`cat.${category}`)).join(", ") || "—"}
          {ignoredCategories.length > 0 && <> | <strong>{t("report.ignored")}</strong> {ignoredCategories.map((category) => t(`cat.${category}`)).join(", ")}</>}
        </p>
      </header>

      <section className="results-list" aria-label="Deployment checks">
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
                  <h2>{check.title}</h2>
                  <p>{check.explanation}</p>
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
                  {check.status === "red" && <div className="repair-cta"><p>{t("report.fixCta")}</p>
                    <Link href={`/checkout?plan=fix-one&report=${id}&check=${check.id}`}>{t("report.fixOne")}</Link>
                    <Link href={`/checkout?plan=fix-all&report=${id}`}>{t("report.fixAll")}</Link>
                  </div>}
                </IssueCard>
              ))}
            </div>
          );
        })}
      </section>

      <section className="report-actions" aria-labelledby="action-heading">
        <div>
          <h2 id="action-heading">{t("report.actionsTitle")}</h2>
          <p>{t("report.actionsBody")}</p>
        </div>
        <div className="action-buttons">
          <CopyFixes parts={parts} />
          <WhenOpenRed checks={checkStates}>
            <Link className="cta-button" href={`/checkout?plan=fix-all&report=${id}`}>
              {t("report.fixAll")}
            </Link>
          </WhenOpenRed>
        </div>
      </section>
      </IgnoreProvider>
    </main>
  );
}
