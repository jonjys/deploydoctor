import { badgeSvg, BADGE_COLORS } from "@/lib/report-badge";
import { repoFromPath } from "@/lib/repo-link";
import { safetyBadge } from "@/lib/repo-safety";
import { cachedRepoSafety } from "@/lib/repo-safety-store";

/** README badge for "Is this GitHub repo safe?". Reads the last stored check only: a badge view never downloads a repository. */
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const name = repo.endsWith(".svg") ? repo.slice(0, -4) : "";
  const fullName = name ? repoFromPath([owner, name]) : null;
  const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", "X-Content-Type-Options": "nosniff" };
  if (!fullName) return new Response(badgeSvg({ left: "DeployDoctor safety", right: "invalid repository", color: BADGE_COLORS.neutral }), { status: 404, headers });
  const { right, color } = safetyBadge(await cachedRepoSafety(fullName));
  return new Response(badgeSvg({ left: "DeployDoctor safety", right, color: BADGE_COLORS[color] }), { headers });
}
