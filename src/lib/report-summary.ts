import type { CheckStatus, ReportResults } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

export function countStatuses(checks: Array<{ status: CheckStatus }>): Record<CheckStatus, number> {
  return checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { red: 0, yellow: 0, green: 0 },
  );
}

/**
 * A report with no result to headline: no Next.js app at the root and no other framework the scan knows, or an app nested in a
 * subfolder. The page and the README badge both read it, so they agree. Older reports have no nextApp and keep their normal headline.
 */
export function neutralReport(results: Pick<ReportResults, "nextApp" | "stack">): boolean {
  return results.nextApp === "nested" || (results.nextApp === "none" && !results.stack?.framework);
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
