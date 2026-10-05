import { getReport } from "@/lib/reports";
import { overallLabel, overallOf } from "@/lib/report-summary";

const colors = { red: "#d6453d", yellow: "#c99a07", green: "#2f8f52", neutral: "#6b7a74" };

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A README badge for a saved public report, in the flat style people already know from shields. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  const results = report && !report.is_private ? report.results : null;
  const status = results ? overallLabel(results.summary) : "report not found";
  const color = results ? colors[overallOf(results.summary)] : colors.neutral;

  const left = "DeployDoctor";
  const charWidth = 6.6;
  const leftWidth = Math.round(left.length * charWidth + 20);
  const rightWidth = Math.round(status.length * charWidth + 20);
  const width = leftWidth + rightWidth;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escape(left)}: ${escape(status)}">
<title>${escape(left)}: ${escape(status)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${leftWidth}" height="20" fill="#10231c"/><rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escape(left)}</text><text x="${leftWidth / 2}" y="13">${escape(left)}</text>
<text x="${leftWidth + rightWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escape(status)}</text><text x="${leftWidth + rightWidth / 2}" y="13">${escape(status)}</text>
</g></svg>`;
  return new Response(svg, {
    status: results ? 200 : 404,
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
