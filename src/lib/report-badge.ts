import type { ReportResults } from "@/types/report";
import { neutralReport, overallLabel, overallOf } from "@/lib/report-summary";

export const BADGE_COLORS = { red: "#d6453d", yellow: "#c99a07", green: "#2f8f52", neutral: "#6b7a74" } as const;

/** The right half of the README badge: the headline the report page shows, in English like the left half. */
export function badgeStatus(results: ReportResults | null): { label: string; color: string } {
  if (!results) return { label: "report not found", color: BADGE_COLORS.neutral };
  const neutral = neutralReport(results);
  return {
    label: overallLabel(results.summary, "en", { notNext: neutral }),
    color: neutral ? BADGE_COLORS.neutral : BADGE_COLORS[overallOf(results.summary)],
  };
}
