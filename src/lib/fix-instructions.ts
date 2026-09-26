import type { StoredReport } from "@/types/report";

export function freeFixInstructions(report: StoredReport) {
  return [`DeployDoctor — ${report.repo_url}`, "Free instructions (no paid code patch included).", "",
    ...report.results.checks.filter((check) => check.status !== "green").map((check) =>
      [`${check.title}: ${check.explanation}`,
        ...(check.findings?.length ? check.findings.map((finding) =>
          `File: ${finding.file}:${finding.line} — ${finding.problem}.\nFix: ${finding.fix}${finding.command ? `\nCommand (after making the change): ${finding.command}` : ""}`)
          : [...check.evidence.map((evidence) => `Evidence: ${evidence}`), `Fix: ${check.fix}`]),
      ].join("\n")),
    report.results.overall === "green" ? "All five checks passed; no changes needed." : "",
  ].filter(Boolean).join("\n\n");
}
