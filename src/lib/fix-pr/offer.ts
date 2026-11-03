import type { CheckResult } from "@/types/report";
import type { CasePatchPlan } from "@/lib/patch/plan";

export type DiagnosisItem = { title: string; status: "red" | "yellow"; file?: string; line?: number; problem: string };
const SECRET = /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]{20,}/g;

/** Free diagnosis: failing checks, file and line, no unified diff and no corrected source. */
export function diagnosisItems(checks: CheckResult[]): DiagnosisItem[] {
  const items: DiagnosisItem[] = [];
  for (const check of checks) {
    if (check.status === "green") continue;
    const findings = check.findings ?? [];
    if (!findings.length) items.push({ title: check.title, status: check.status, problem: check.explanation.slice(0, 240) });
    else for (const finding of findings.slice(0, 4)) items.push({ title: check.title, status: check.status, file: finding.file, line: finding.line, problem: finding.problem.slice(0, 240) });
    if (items.length >= 12) break;
  }
  return items.slice(0, 12);
}

/** The paywalled change, described without the replacement text. */
export function publicFixes(plan: CasePatchPlan): { file: string; line: number; problem: string }[] {
  return plan.fixes.map((fix) => ({ file: fix.file, line: fix.line, problem: "Import letter case does not match the file. Linux builds fail on this; macOS often does not." }));
}

export function summarizeError(items: { title: string; problem: string }[]): string {
  return items.slice(0, 3).map((item) => `${item.title}: ${item.problem}`).join(" ").replace(SECRET, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 180);
}
