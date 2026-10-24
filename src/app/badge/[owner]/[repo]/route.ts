import { badgeSvg, BADGE_COLORS } from "@/lib/report-badge";
import { repoStatus, statusRepository } from "@/lib/repo-status";
import { latestPublicRepoReport } from "@/lib/repo-status-store";

export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const name = repo.endsWith(".svg") ? repo.slice(0, -4) : "";
  const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=60", "X-Content-Type-Options": "nosniff" };
  if (!statusRepository(owner, name)) return new Response(badgeSvg({ left: "DeployDoctor", right: "invalid repository", color: BADGE_COLORS.neutral }), { status: 404, headers });
  try {
    const report = await latestPublicRepoReport(owner.toLowerCase(), name.toLowerCase());
    const status = repoStatus(report);
    const right = [status.label, status.date, status.commit].filter(Boolean).join(" · ");
    return new Response(badgeSvg({ left: "DeployDoctor", right, color: status.color }), { status: report ? 200 : 404, headers });
  } catch {
    return new Response(badgeSvg({ left: "DeployDoctor", right: "status unavailable", color: BADGE_COLORS.neutral }), { status: 503, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}
