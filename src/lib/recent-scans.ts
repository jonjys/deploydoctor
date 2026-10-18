import { repoUrlFromParam } from "@/lib/repo-input";

export type RecentScan = { id: string; repo: string; at: number };
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;

/** Browser data may be old or malformed. Keep the last opened report for each valid repository. */
export function recentRepositories(value: unknown, now = Date.now(), limit = 3): RecentScan[] {
  if (!Array.isArray(value)) return [];
  const valid: RecentScan[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string"
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || typeof item.repo !== "string"
      || typeof item.at !== "number" || !Number.isFinite(item.at) || item.at > now || item.at <= now - MAX_AGE) continue;
    const repo = repoUrlFromParam(item.repo);
    if (repo) valid.push({ id: item.id, repo, at: item.at });
  }
  valid.sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return valid.filter((item) => {
    const key = item.repo.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
