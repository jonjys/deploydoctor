import { launchReadiness } from "@/lib/launch-readiness";
import type { StoredReport } from "@/types/report";
import { SITE_URL } from "@/lib/site";
import { improvementCopy } from "@/lib/improvements";

/** The machine-readable shape of a report, shared by the CI token API and the public report endpoint. */
export function reportJson(report: StoredReport) {
  const { results } = report;
  return {
    id: report.id,
    href: `/r/${report.id}`,
    url: `${SITE_URL}/r/${report.id}`,
    repoUrl: report.repo_url,
    ref: results.repository.ref ?? results.repository.defaultBranch,
    commitSha: results.repository.commitSha ?? null,
    checkedAt: results.checkedAt,
    overall: results.overall,
    summary: results.summary,
    partial: results.scan.partial,
    scan: results.scan,
    stack: results.stack ?? null,
    nextApp: results.nextApp ?? null,
    pullRequest: results.pullRequest ?? null,
    checks: results.checks.map((check) => ({
      id: check.id, title: check.title, status: check.status, explanation: check.explanation, fix: check.fix,
      evidence: check.evidence, findings: check.findings ?? [], suggestedFile: check.suggestedFile ?? null,
      evaluatedRules: check.evaluatedRules ?? null, coverageOnly: check.coverageOnly ?? false,
    })),
    launchReadiness: launchReadiness(results, report.id, Boolean(report.is_private)),
    // Not errors: suggestions that make the app better on Vercel. Relative docs links point at this site.
    improvements: (results.improvements ?? []).filter(item => !(report.is_private && item.id === "readme-badge")).map(item => {
      const copy = improvementCopy(item, "en");
      const docs = copy.docs?.startsWith("#") ? `${SITE_URL}/r/${report.id}${copy.docs}` : copy.docs?.startsWith("/") ? `${SITE_URL}${copy.docs}` : copy.docs ?? null;
      return { id: item.id, file: item.file, title: copy.title, why: copy.why, how: copy.how, docs };
    }),
    isPrivate: Boolean(report.is_private),
    limitations: "Static analysis only. Nothing is cloned, installed, built or executed. Review findings against the current code.",
  };
}
