import Link from "next/link";
import { CopyTextButton } from "@/components/copy-text-button";
import type { RepoSafetyReport, Severity } from "@/lib/repo-safety";
import type { DependencyReport, DependencyTeaser } from "@/lib/dependency-safety";
import { DependencySection } from "./dependency-section";

const VERDICT = {
  "red-flags": { className: "is-bad", line: "Do not download or run it until you have read the lines below." },
  check: { className: "is-mid", line: "Nothing alarming in the code, but read these before you run it." },
  "no-red-flags": { className: "is-good", line: "No suspicious patterns in the files we read. That is not a guarantee: read what you run." },
} as const;
const STATUS: Record<Severity, string> = { high: "fail", medium: "warn", low: "info", info: "pass" };
const LABEL: Record<Severity, string> = { high: "Red flag", medium: "Read this", low: "Worth knowing", info: "Fact" };
const SITE = "https://deploydoctor.nyttolabs.com";

/** One safety result. Used by the form after a check and by the repository's own page from the stored check. */
export function RepoSafetyResult({ report, dependencies }: { report: RepoSafetyReport; dependencies?: DependencyReport | DependencyTeaser | null }) {
  const verdict = VERDICT[report.verdict];
  const page = `${SITE}/is-this-repo-safe/${report.repo}`;
  const badge = `[![DeployDoctor safety](${SITE}/badge/safe/${report.repo}.svg)](${page})`;
  const share = `https://x.com/intent/tweet?text=${encodeURIComponent(`Checked ${report.repo} before running it: ${report.headline.toLowerCase()}.\n\nCheck a GitHub repo before you download it:`)}&url=${encodeURIComponent(page)}`;
  return (
    <section className="safe-result" aria-live="polite">
      <div className={`safe-verdict ${verdict.className}`}>
        <p className="section-kicker">{report.repo} · {report.filesRead} of {report.filesInRepo} files read{report.partial ? " · partial" : ""}{report.checkedAt ? ` · checked ${report.checkedAt.slice(0, 10)}${report.commit ? ` at ${report.commit}` : ""}` : ""}</p>
        <h2>{report.headline}</h2>
        <p>{verdict.line}</p>
      </div>
      {report.findings.length > 0 && (
        <ol className="safe-findings">
          {report.findings.map(f => (
            <li key={f.id} className={`is-${STATUS[f.severity]}`}>
              <span className="safe-area">{LABEL[f.severity]}{f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ""}` : ""}</span>
              <strong>{f.title}</strong>
              <p>{f.detail}</p>
              {f.excerpt && <pre className="repo-safety-excerpt"><code>{f.excerpt}</code></pre>}
            </li>
          ))}
        </ol>
      )}
      {dependencies && <DependencySection repo={report.repo} dependencies={dependencies} />}
      <p className="plugin-line">A static check reads code for known tricks. It cannot prove a program is safe, and new tricks appear every week. If in doubt, run it in a virtual machine or not at all.</p>
      {report.verdict !== "red-flags" && (
        <div className="safe-verify">
          <strong>Maintain this repo? Show it in your README</strong>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <p><img src={`/badge/safe/${report.repo}.svg`} alt="DeployDoctor safety badge" height={20} /></p>
          <p className="plugin-line">The badge shows the last check and its date, and links here so people can check again before they download.</p>
          <div className="action-buttons"><CopyTextButton text={badge} label="Copy badge markdown" copiedLabel="Copied" /></div>
        </div>
      )}
      <p><a className="cta-button" href={share} target="_blank" rel="noopener noreferrer">Share this check on X</a></p>
      <p>Building your own app? <Link href="/#scan-repository">Scan it before you deploy</Link>.</p>
    </section>
  );
}
