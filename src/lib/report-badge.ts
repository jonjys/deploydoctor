import type { ReportResults } from "@/types/report";
import { neutralReport, overallLabel, overallOf } from "@/lib/report-summary";

export const BADGE_COLORS = { red: "#d6453d", yellow: "#c99a07", green: "#2f8f52", neutral: "#6b7a74" } as const;
/** The site's ink: the left half of the report badge and the brand half of the scan button. */
export const BADGE_INK = "#10231c";

/** The right half of the README badge: the headline the report page shows, in English like the left half. */
export function badgeStatus(results: ReportResults | null): { label: string; color: string } {
  if (!results) return { label: "report not found", color: BADGE_COLORS.neutral };
  const neutral = neutralReport(results);
  return {
    label: overallLabel(results.summary, "en", { notNext: neutral }),
    color: neutral ? BADGE_COLORS.neutral : BADGE_COLORS[overallOf(results.summary)],
  };
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A flat two-part badge in the style people know from shields: `left` on `leftColor`, `right` on `color`. */
export function badgeSvg({ left, right, color, leftColor = BADGE_INK, label = `${left}: ${right}` }:
  { left: string; right: string; color: string; leftColor?: string; label?: string }): string {
  const charWidth = 6.6;
  const leftWidth = Math.round(left.length * charWidth + 20);
  const rightWidth = Math.round(right.length * charWidth + 20);
  const width = leftWidth + rightWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escape(label)}">
<title>${escape(label)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${leftWidth}" height="20" fill="${leftColor}"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escape(left)}</text><text x="${leftWidth / 2}" y="13">${escape(left)}</text>
<text x="${leftWidth + rightWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escape(right)}</text><text x="${leftWidth + rightWidth / 2}" y="13">${escape(right)}</text>
</g></svg>`;
}
