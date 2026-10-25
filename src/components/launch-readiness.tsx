import Link from "next/link";
import type { ReportResults } from "@/types/report";
import { launchReadiness } from "@/lib/launch-readiness";

export function LaunchReadiness({ results, reportId }: { results: ReportResults; reportId: string }) {
  const launch = launchReadiness(results, reportId);
  return <section className="launch-readiness" aria-labelledby="launch-readiness-title">
    <p className="section-kicker">LAUNCH READINESS · STATIC PREFLIGHT</p>
    <h2 id="launch-readiness-title">Before you send the traffic</h2>
    <p>{launch.statement}</p>
    <div className="launch-counts"><span><strong>{launch.criticalBlockers.length}</strong> critical blockers</span><span><strong>{launch.reviewBeforeLaunch.length}</strong> to review</span><span>{results.scan.partial ? "Partial source coverage" : "Source coverage recorded below"}</span></div>
    <p><strong>Next action:</strong> {launch.nextAction}</p>
    <details><summary>Your launch checklist</summary>
      <h3>Critical blockers</h3>{launch.criticalBlockers.length ? <ul>{launch.criticalBlockers.map(f => <li key={f.id}><Link href={f.href}>{f.problem}</Link><p>{f.file && <code>{f.file}:{f.line}</code>} — {f.fix}</p></li>)}</ul> : <p>No critical findings in the checks performed.</p>}
      <h3>Review before launch</h3>{launch.reviewBeforeLaunch.length ? <ul>{launch.reviewBeforeLaunch.map(f => <li key={f.id}><Link href={f.href}>{f.problem}</Link><p>{f.file && <code>{f.file}:{f.line}</code>} — {f.fix}</p></li>)}</ul> : <p>No review findings in the checks performed.</p>}
      <h3>Manual verification · not completed</h3><ul>{launch.checklist.filter(i => i.kind === "manual").map(i => <li key={i.id}>{i.action}</li>)}</ul>
      <p>Existing verified import repairs, when eligible, are available in the Broken imports check. Every patch and draft PR still requires your explicit authorization.</p>
      <h3>Not verified</h3><ul>{launch.notVerified.map(text => <li key={text}>{text}</li>)}</ul>
      <h3>Checks performed</h3><ul>{launch.checksPerformed.map(c => <li key={c.checkId}>{c.title}: {c.coverageOnly ? "coverage incomplete" : c.status === "green" ? "no matching findings" : "findings to review"}{c.evaluatedRules && <> · {c.evaluatedRules.length} applicable production rule families evaluated</>}</li>)}</ul>
    </details>
  </section>;
}
