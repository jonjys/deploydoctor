import { repoFromPath } from "@/lib/repo-link";
import { clonedRepo } from "@/lib/vercel-log";

export type FixTarget = { kind: "repo"; repo: string } | { kind: "needs-repo"; liveUrl: string };

const VERCEL_APP = /^(?:[a-z0-9-]+\.)*vercel\.app$/i;

/**
 * What a visitor pastes: a GitHub repo, a Vercel build log (the clone line names the repo),
 * or a live *.vercel.app URL. A deployment URL has no owner/repo, so the page asks for the repo.
 */
export function parseFixTarget(input: string): FixTarget | null {
  const text = input.trim();
  if (!text || text.length > 20_000) return null;
  const fromLog = clonedRepo(text);
  if (fromLog) return { kind: "repo", repo: fromLog };
  if (/[\s\n]/.test(text)) return null;
  const looksLikeUrl = /^https?:\/\//i.test(text) || text.includes(".");
  let url: URL | null = null;
  if (looksLikeUrl) {
    try { url = new URL(text.includes("://") ? text : `https://${text}`); } catch { url = null; }
  }
  if (url && (url.protocol === "https:" || url.protocol === "http:")) {
    if (url.username || url.password) return null;
    if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      const repo = repoFromPath(url.pathname.split("/").filter(Boolean));
      return repo ? { kind: "repo", repo } : null;
    }
    if (VERCEL_APP.test(url.hostname) && url.protocol === "https:") return { kind: "needs-repo", liveUrl: `https://${url.hostname}` };
    return null;
  }
  const repo = repoFromPath(text.split("/").filter(Boolean));
  return repo ? { kind: "repo", repo } : null;
}
