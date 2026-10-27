import Link from "next/link";
import type { ReportResults } from "@/types/report";
import { launchReadiness } from "@/lib/launch-readiness";

export function LaunchReadiness({ results, reportId, isPrivate = false }: { results: ReportResults; reportId: string; isPrivate?: boolean }) {
  const launch = launchReadiness(results, reportId, isPrivate);
  return <details className="launch-readiness">
    <summary>Launch checklist and scan limitations</summary>
    <p>{launch.statement}</p>
    <p><Link href="#checks">Return to findings and available fixes ↑</Link></p>
    <h3>Manual verification · not completed</h3><ul>{launch.checklist.filter(i => i.kind === "manual").map(i => <li key={i.id}>{i.action}</li>)}</ul>
    <h3>Not verified</h3><ul>{launch.notVerified.map(text => <li key={text}>{text}</li>)}</ul>
    <h3>Checks performed</h3><ul>{launch.checksPerformed.map(c => <li key={c.checkId}>{c.title}: {c.coverageOnly ? "coverage incomplete" : c.status === "green" ? "no matching findings" : "findings to review"}{c.evaluatedRules && <> · {c.evaluatedRules.length} applicable production rule families evaluated</>}</li>)}</ul>
  </details>;
}
