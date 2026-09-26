import type { CheckStatus } from "@/types/report";

export function countStatuses(checks: Array<{ status: CheckStatus }>): Record<CheckStatus, number> {
  return checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { red: 0, yellow: 0, green: 0 },
  );
}

export function overallOf(summary: Record<CheckStatus, number>): CheckStatus {
  return summary.red ? "red" : summary.yellow ? "yellow" : "green";
}

export function overallLabel(summary: Record<CheckStatus, number>): string {
  return summary.red
    ? `${summary.red} ${summary.red === 1 ? "issue" : "issues"} to fix`
    : summary.yellow
      ? `${summary.yellow} ${summary.yellow === 1 ? "item" : "items"} to review`
      : "Ready to deploy";
}
