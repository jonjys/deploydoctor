import { ImageResponse } from "next/og";
import { repoFromPath } from "@/lib/repo-link";
import { cachedRepoSafety } from "@/lib/repo-safety-store";

export const runtime = "nodejs";

const TONE = { "red-flags": "#ff6b5f", check: "#f0c050", "no-red-flags": "#b9f227" } as const;

/** 1200x630 link preview for a repository's safety page. Reads the stored check only; never downloads the repository. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("repo") ?? "";
  const name = repoFromPath([raw]);
  const report = name ? await cachedRepoSafety(name).catch(() => null) : null;
  const tone = report ? TONE[report.verdict] : "#b9f227";
  const headline = report ? report.headline : "Check the code before you download it";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 76px", background: "#0f1a16", color: "#eef2ee" }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 28, letterSpacing: 4, color: "#9aa8a2" }}>
        <div style={{ width: 20, height: 20, borderRadius: 10, background: tone, marginRight: 16 }} />BEFORE YOU DOWNLOAD
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: name && name.length > 30 ? 52 : 64, fontWeight: 700, lineHeight: 1.1 }}>{name ? `Is ${name} safe to run?` : "Is this GitHub repo safe?"}</div>
        <div style={{ fontSize: 40, color: tone, marginTop: 24, fontWeight: 700 }}>{headline}</div>
        {report && <div style={{ fontSize: 28, color: "#9aa8a2", marginTop: 12 }}>{`${report.filesRead} files read · checked ${report.checkedAt?.slice(0, 10) ?? ""}`}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#9aa8a2" }}>
        <span style={{ color: "#eef2ee", fontWeight: 700 }}>deploydoctor.nyttolabs.com</span><span>free · nothing is run</span>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" } },
  );
}
