import { getReport } from "@/lib/reports";
import { badgeStatus, badgeSvg } from "@/lib/report-badge";

/** A README badge for a saved public report, in the flat style people already know from shields. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  const results = report && !report.is_private ? report.results : null;
  const { label: status, color } = badgeStatus(results);
  return new Response(badgeSvg({ left: "DeployDoctor", right: status, color }), {
    status: results ? 200 : 404,
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
