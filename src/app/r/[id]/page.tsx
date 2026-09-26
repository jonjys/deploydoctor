import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyFixesButton } from "@/components/copy-fixes-button";
import { getReport } from "@/lib/reports";
import type { CheckStatus } from "@/types/report";
import { freeFixInstructions } from "@/lib/fix-instructions";

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
  const instructions = freeFixInstructions(report);
  const overallLabel =
    results.overall === "red"
      ? `${results.summary.red} ${results.summary.red === 1 ? "issue" : "issues"} to fix`
      : results.overall === "yellow"
        ? `${results.summary.yellow} ${results.summary.yellow === 1 ? "item" : "items"} to review`
        : "Ready to deploy";

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

      <header className="report-header">
        <Link className="back-link" href="/">
          ← Scan another repository
        </Link>
        <div className="report-heading-row">
          <div>
            <p className="section-kicker">DEPLOYMENT REPORT</p>
            <h1>{repoName}</h1>
          </div>
          <div className={`score-card is-${results.overall}`}>
            <span>OVERALL RESULT</span>
            <strong>{overallLabel}</strong>
          </div>
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
      </header>

      <section className="results-list" aria-label="Deployment checks">
        {results.checks.map((check, index) => (
          <article className={`result-card is-${check.status}`} key={check.id}>
            <div className="result-status">
              <span className="status-symbol" aria-hidden="true">
                {statusSymbols[check.status]}
              </span>
              {statusLabels[check.status]}
            </div>
            <div className="result-body">
              <span className="result-number">CHECK {String(index + 1).padStart(2, "0")}</span>
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
            </div>
          </article>
        ))}
      </section>

      <section className="report-actions" aria-labelledby="action-heading">
        <div>
          <h2 id="action-heading">Want the red flags gone?</h2>
          <p>Exakta filer och steg är gratis. Beställ en kodpatch efter manuell granskning.</p>
        </div>
        <div className="action-buttons">
          <CopyFixesButton instructions={instructions} />
          {results.summary.red > 0 && <Link
            className="cta-button"
            href={`/checkout?plan=fix-all&report=${id}`}
          >
            Fixa allt $25
          </Link>}
        </div>
      </section>
    </main>
  );
}
