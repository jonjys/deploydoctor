import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyFixes, IgnoreProvider, IssueCard, ScoreCard, WhenOpenRed } from "@/components/report-ignore";
import { getReport } from "@/lib/reports";
import type { Category, CheckStatus } from "@/types/report";
import { freeFixParts } from "@/lib/fix-instructions";
import { CATEGORIES, CATEGORY_LABELS, categoryOf } from "@/lib/categories";

const statusLabels: Record<CheckStatus, string> = {
  red: "Fail",
  yellow: "Review",
  green: "Pass",
};

const statusSymbols: Record<CheckStatus, string> = {
  red: "×",
  yellow: "!",
  green: "✓",
};

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return { title: "Report not found — DeployDoctor" };
  return {
    title: `${report.results.repository.owner}/${report.results.repository.name} report — DeployDoctor`,
    description: `Vercel readiness report with ${report.results.summary.red} failed checks.`,
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  const { results } = report;
  const repoName = `${results.repository.owner}/${results.repository.name}`;
  const parts = freeFixParts(report);
  const checkStates = results.checks.map(({ id, status }) => ({ id, status }));
  // Reports saved before category filtering have no scope: everything they contain was scanned.
  const present = new Set<Category>(results.checks.map(categoryOf));
  const scanned = results.scope?.scanned ?? CATEGORIES.filter((category) => present.has(category));
  const ignoredCategories = results.scope?.ignored ?? [];

  return (
    <main className="site-shell report-page">
      <nav className="topbar" aria-label="Primary navigation">
        <Link className="brand" href="/">
          <span className="logo-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>DeployDoctor</span>
        </Link>
        <span className="nav-note">
          <span className="status-dot" /> {report.is_private ? "Private report" : "Saved report · free to view"}
        </span>
      </nav>

      <IgnoreProvider reportId={id}>
      <header className="report-header">
        <Link className="back-link" href="/">
          ← Scan another repository
        </Link>
        <div className="report-heading-row">
          <div>
            <p className="section-kicker">DEPLOYMENT REPORT</p>
            <h1>{repoName}</h1>
          </div>
          <ScoreCard checks={checkStates} />
        </div>
        <div className="report-meta">
          <a className="report-repo" href={report.repo_url} target="_blank" rel="noreferrer">
            {report.repo_url} ↗
          </a>
          <span>Branch: {results.repository.defaultBranch}</span>
          <span>
            Scanned {results.scan.sourceFilesRead} of {results.scan.sourceFilesFound} source files
          </span>
          <span>{new Date(report.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>
        <p className="scope-line">
          <strong>Scannat:</strong> {scanned.map((category) => CATEGORY_LABELS[category]).join(", ") || "—"}
          {ignoredCategories.length > 0 && <> | <strong>Ignorerat:</strong> {ignoredCategories.map((category) => CATEGORY_LABELS[category]).join(", ")}</>}
        </p>
      </header>

      <section className="results-list" aria-label="Deployment checks">
        {scanned.map((category) => {
          const group = results.checks.filter((check) => categoryOf(check) === category);
          if (!group.length) return null;
          return (
            <div className="check-group" key={category}>
              <p className="section-kicker group-title">{CATEGORY_LABELS[category].toUpperCase()}</p>
              {group.map((check) => (
                <IssueCard key={check.id} id={check.id} title={check.title} status={check.status}
                  symbol={statusSymbols[check.status]} label={statusLabels[check.status]}>
                  <span className="result-number">CHECK {String(results.checks.indexOf(check) + 1).padStart(2, "0")}</span>
                  <h2>{check.title}</h2>
                  <p>{check.explanation}</p>
                  {check.evidence.length ? (
                    <ul className="evidence-list" aria-label="Evidence">
                      {check.evidence.map((item) => (
                        <li key={item}>↳ {item}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="fix-box">
                    <strong>Suggested fix:</strong> {check.fix}
                  </div>
                  {check.status === "red" && <div className="repair-cta"><p>Vill du att vi fixar det?</p>
                    <Link href={`/checkout?plan=fix-one&report=${id}&check=${check.id}`}>Fixa den här $5</Link>
                    <Link href={`/checkout?plan=fix-all&report=${id}`}>Fixa allt $25</Link>
                  </div>}
                </IssueCard>
              ))}
            </div>
          );
        })}
      </section>

      <section className="report-actions" aria-labelledby="action-heading">
        <div>
          <h2 id="action-heading">Want the red flags gone?</h2>
          <p>Exakta filer och steg är gratis. Beställ en kodpatch efter manuell granskning.</p>
        </div>
        <div className="action-buttons">
          <CopyFixes parts={parts} />
          <WhenOpenRed checks={checkStates}>
            <Link className="cta-button" href={`/checkout?plan=fix-all&report=${id}`}>
              Fixa allt $25
            </Link>
          </WhenOpenRed>
        </div>
      </section>
      </IgnoreProvider>
    </main>
  );
}
