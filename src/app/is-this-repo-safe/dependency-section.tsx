import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import type { DependencyReport, DependencyTeaser, DepSeverity } from "@/lib/dependency-safety";

const STATUS: Record<DepSeverity, string> = { critical: "fail", high: "fail", medium: "warn", info: "info" };
const LABEL: Record<DepSeverity, string> = { critical: "Critical", high: "High", medium: "Read this", info: "Fact" };

/** npm dependencies of a checked repository. Without a pass: counts only. With one: every package, version and reason. */
export function DependencySection({ repo, dependencies }: { repo: string; dependencies: DependencyReport | DependencyTeaser }) {
  const flagged = dependencies.counts.critical + dependencies.counts.high + dependencies.counts.medium;
  const scope = `${dependencies.total.toLocaleString("en-US")} npm package${dependencies.total === 1 ? "" : "s"} (${dependencies.direct} direct)${dependencies.lockfile ? "" : " · no lockfile, so direct dependencies only"}${dependencies.partial ? " · partial" : ""}`;
  return (
    <section className="dep-check" aria-labelledby="dep-check-title">
      <p className="section-kicker">DEPENDENCIES</p>
      <h2 id="dep-check-title">{flagged ? `${flagged} of its packages need a look` : "No red flags in its packages"}</h2>
      <p className="plugin-line">{scope}. Checked for known malware and security advisories, look-alike names, unexpected install scripts and packages almost nobody uses.</p>
      {"locked" in dependencies ? (
        flagged ? (
          <div className="plan-unlock">
            <div>
              <strong>{dependencies.counts.critical} critical · {dependencies.counts.high} high · {dependencies.counts.medium} to read</strong>
              <p>The code in the repository can be clean while a package it installs is not. See which packages, the versions, and why each one was flagged. Included in the 24-hour pass with unlimited scans.</p>
            </div>
            <ScanCheckoutButton plan="day" context={`safety:${repo}`}>See which packages · $2 →</ScanCheckoutButton>
          </div>
        ) : null
      ) : dependencies.findings.length ? (
        <ol className="safe-findings">
          {dependencies.findings.map(f => (
            <li key={`${f.kind}-${f.package}-${f.title}`} className={`is-${STATUS[f.severity]}`}>
              <span className="safe-area">{LABEL[f.severity]} · {f.package}{f.version ? `@${f.version}` : ""}</span>
              <strong>{f.title}</strong>
              <p>{f.detail}{f.url ? <> <a href={f.url} target="_blank" rel="noopener noreferrer">Advisory ↗</a></> : null}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
