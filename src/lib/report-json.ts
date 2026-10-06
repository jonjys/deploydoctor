import type { StoredReport } from "@/types/report";
import { SITE_URL } from "@/lib/site";

/** The machine-readable shape of a report, shared by the CI token API and the public report endpoint. */
export function reportJson(report: StoredReport) {
  const { results } = report;
  return {
    id: report.id,
    href: `/r/${report.id}`,
    url: `${SITE_URL}/r/${report.id}`,
    repoUrl: report.repo_url,
    ref: results.repository.ref ?? results.repository.defaultBranch,
    checkedAt: results.checkedAt,
    overall: results.overall,
    summary: results.summary,
    partial: results.scan.partial,
    scan: results.scan,
    stack: results.stack ?? null,
    nextApp: results.nextApp ?? null,
    checks: results.checks.map((check) => ({
      id: check.id, title: check.title, status: check.status, explanation: check.explanation, fix: check.fix,
      evidence: check.evidence, findings: check.findings ?? [], suggestedFile: check.suggestedFile ?? null,
    })),
    isPrivate: Boolean(report.is_private),
    limitations: "Static analysis only. Nothing is cloned, installed, built or executed. Review findings against the current code.",
  };
}
