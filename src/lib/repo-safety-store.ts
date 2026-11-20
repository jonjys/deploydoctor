import "server-only";
import { db, query } from "@/lib/db";
import { digest } from "@/lib/session-token";
import type { RepoSafetyReport } from "@/lib/repo-safety";

/**
 * The last safety check per public repository, so the README badge, the repo's page and its link preview can show it
 * without downloading the repository again. Badge and page views only read; only a visitor's check writes.
 */
const TTL_MS = 7 * 86_400_000;
const keyFor = (fullName: string) => digest(`repo-safety-v1:${fullName.toLowerCase()}`);

export async function cachedRepoSafety(fullName: string): Promise<RepoSafetyReport | null> {
  const rows = await db<Array<{ results: RepoSafetyReport }>>(query("public_scan_cache", {
    key: `eq.${keyFor(fullName)}`, expires_at: `gt.${new Date().toISOString()}`, select: "results", limit: "1",
  })).catch(() => []);
  return rows[0]?.results ?? null;
}

export async function storeRepoSafety(report: RepoSafetyReport): Promise<void> {
  await db(query("public_scan_cache", { on_conflict: "key" }), { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: keyFor(report.repo), results: report, expires_at: new Date(Date.now() + TTL_MS).toISOString() }),
  }).catch(() => console.error("Repo safety cache write failed"));
}
