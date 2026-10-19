import { db, query, rpc } from "@/lib/db";
import { analyzeGitHubRepository, GitHubApiError, githubRequest, parseGitHubRepoUrl } from "@/lib/github";
import { saveReport } from "@/lib/reports";
import { SITE_URL } from "@/lib/site";
import { cronAuthorized, cronSecret, runWatchCron, sendWatchEmail, unsubscribeToken, watchConfig, type WatchRow } from "@/lib/watch";
import type { StoredReport } from "@/types/report";

// The Hobby plan limit with Fluid compute. The job stops taking new watches well before it, see runWatchCron.
export const maxDuration = 300;

const PENDING_DAYS = 7;

/**
 * Daily Watch this repo job, called by Vercel Cron (vercel.json) with Authorization: Bearer CRON_SECRET.
 * Rescans up to 40 confirmed watches, longest waiting first, and emails only when something new broke.
 * Rescans never use a visitor's free daily scans.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret || !watchConfig()) return Response.json({ error: "Watch is not configured." }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  // Unconfirmed watches whose link has expired are deleted, so an address nobody confirmed is not kept.
  await db(query("repo_watches", { confirmed_at: "is.null", created_at: `lt.${new Date(Date.now() - PENDING_DAYS * 86_400_000).toISOString()}` }),
    { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => console.error("Watch cleanup failed"));

  await db(query("public_scan_cache", { expires_at: `lt.${new Date().toISOString()}` }),
    { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => console.error("Scan cache cleanup failed"));
  const summary = await runWatchCron({
    claim: (limit) => rpc<WatchRow[]>("claim_repo_watches", { p_limit: limit }),
    loadReport: async (id) => (await db<StoredReport[]>(query("reports", { id: `eq.${id}`, select: "id,repo_url,results,created_at", limit: "1" })))[0] ?? null,
    pushedAt: async (repoUrl) => {
      const { owner, name } = parseGitHubRepoUrl(repoUrl);
      const repo = await githubRequest<{ private: boolean; pushed_at?: string | null }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, process.env.GITHUB_TOKEN);
      if (repo.private) throw new GitHubApiError("DeployDoctor only scans public repositories.", 400, "gh.privateOnly");
      const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : NaN;
      return Number.isFinite(pushed) ? pushed : null;
    },
    scan: (repoUrl, options) => analyzeGitHubRepository(repoUrl, options),
    save: (repoUrl, results) => saveReport(repoUrl, results),
    setBaseline: async (watchId, reportId) => {
      await db(query("repo_watches", { id: `eq.${watchId}` }), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_report_id: reportId }),
      });
    },
    send: (message) => sendWatchEmail(message),
    isRateLimit: (error) => error instanceof GitHubApiError && error.key === "gh.rateLimit",
    unsubscribeUrl: (watchId) => `${SITE_URL}/api/watch/unsubscribe?token=${unsubscribeToken(watchId)}`,
    siteUrl: SITE_URL,
  });
  console.log("dd-watch", JSON.stringify(summary));
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
