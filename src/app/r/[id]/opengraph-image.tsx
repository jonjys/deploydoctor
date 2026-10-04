import { ImageResponse } from "next/og";
import { getReport } from "@/lib/reports";
import { overallLabel, overallOf } from "@/lib/report-summary";

export const alt = "DeployDoctor report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const colors = { red: "#ff6b63", yellow: "#f2c94c", green: "#9be36d", neutral: "#b7c2bd" };

/** Link preview for a shared report: repo name, overall result and the counts. Private reports render a generic card. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  const results = report && !report.is_private ? report.results : null;
  const overall = results ? overallOf(results.summary) : "neutral";
  const headline = results ? overallLabel(results.summary) : "Saved report";
  const repo = results ? `${results.repository.owner}/${results.repository.name}` : "DeployDoctor";
  const total = results ? results.checks.length : 0;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: "64px 72px", background: "#10231c", color: "#f5f3ea", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 34, height: 34, borderRadius: 17, border: "3px solid #b9f227", display: "flex", alignItems: "center", justifyContent: "center", color: "#b9f227", fontSize: 20, fontWeight: 700 }}>x</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>DeployDoctor</div>
          </div>
          <div style={{ fontSize: 20, color: "#b7c2bd", letterSpacing: 2 }}>VERCEL READINESS REPORT</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: repo.length > 34 ? 44 : 60, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, maxWidth: 1050 }}>{repo}</div>
          <div style={{ fontSize: 46, fontWeight: 700, color: colors[overall] }}>{headline}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {results ? (
              <>
                <Pill color={colors.red} label={`${results.summary.red} fail`} />
                <Pill color={colors.yellow} label={`${results.summary.yellow} review`} />
                <Pill color={colors.green} label={`${results.summary.green} pass`} />
                <Pill color="#b7c2bd" label={`${total} checks`} />
              </>
            ) : (
              <Pill color="#b7c2bd" label="Open the link to view the report" />
            )}
          </div>
          <div style={{ fontSize: 22, color: "#b9f227" }}>deploydoctor.nyttolabs.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999, border: `2px solid ${color}`, color, fontSize: 22, fontWeight: 600 }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
      {label}
    </div>
  );
}
