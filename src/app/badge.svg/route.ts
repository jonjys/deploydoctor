import { BADGE_COLORS, BADGE_INK, badgeSvg } from "@/lib/report-badge";

/** The one badge that never changes: the Scan with DeployDoctor button a README links to its repository's instant scan. */
const SVG = badgeSvg({ left: "Scan with", right: "DeployDoctor", leftColor: BADGE_COLORS.neutral, color: BADGE_INK, label: "Scan with DeployDoctor" });

/** GET /badge.svg: no database and no request data, the same bytes for everyone, so browsers and GitHub's image proxy keep it for a day. */
export function GET() {
  return new Response(SVG, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
  });
}
