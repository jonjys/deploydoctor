import type { CheckStatus } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

export function countStatuses(checks: Array<{ status: CheckStatus }>): Record<CheckStatus, number> {
  return checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { red: 0, yellow: 0, green: 0 },
  );
}

export function overallOf(summary: Record<CheckStatus, number>): CheckStatus {
  return summary.red ? "red" : summary.yellow ? "yellow" : "green";
}

export function overallLabel(summary: Record<CheckStatus, number>, lang: Lang = "en", options: { notNext?: boolean } = {}): string {
  if (options.notNext) return t(lang, "report.notNextApp");
  return summary.red
    ? summary.red === 1 ? t(lang, "report.issue1") : t(lang, "report.issues", { n: summary.red })
    : summary.yellow
      ? summary.yellow === 1 ? t(lang, "report.item1") : t(lang, "report.items", { n: summary.yellow })
      : t(lang, "report.ready");
}
