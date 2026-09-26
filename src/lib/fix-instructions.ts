import type { CheckResult, StoredReport } from "@/types/report";

function checkText(check: CheckResult) {
  return [`${check.title}: ${check.explanation}`,
    ...(check.findings?.length ? check.findings.map((finding) =>
      `File: ${finding.file}:${finding.line} — ${finding.problem}.\nFix: ${finding.fix}${finding.command ? `\nCommand (after making the change): ${finding.command}` : ""}`)
      : [...check.evidence.map((evidence) => `Evidence: ${evidence}`), `Fix: ${check.fix}`]),
  ].join("\n");
}

/** Pieces are joined on the client so issues the reader ignored can be left out. */
export function freeFixParts(report: StoredReport) {
  return {
    head: `DeployDoctor — ${report.repo_url}\n\nFree instructions (no paid code patch included).`,
    items: report.results.checks.filter((check) => check.status !== "green").map((check) => ({ id: check.id, text: checkText(check) })),
    allPassed: "All scanned checks passed; no changes needed.",
  };
}

export function joinFixParts(parts: ReturnType<typeof freeFixParts>, ignored: ReadonlySet<string> = new Set()) {
  const open = parts.items.filter((item) => !ignored.has(item.id));
  return [parts.head, ...open.map((item) => item.text), open.length ? "" : parts.allPassed].filter(Boolean).join("\n\n");
}

export function freeFixInstructions(report: StoredReport) {
  return joinFixParts(freeFixParts(report));
}
