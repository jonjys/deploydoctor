export type RescueEntry = { repo: string; error: string; liveUrl: string; prUrl: string; fixedAt: string };

const SECRET = /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]{20,}/g;
const REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

/** https live site, never a GitHub URL and never with embedded credentials. */
export function cleanLiveUrl(value: string): string | null {
  try {
    const live = new URL(value);
    if (live.protocol !== "https:" || live.username || live.password || live.hostname === "github.com" || live.hostname === "www.github.com") return null;
    if (live.hostname.length > 200) return null;
    const path = live.pathname === "/" ? "" : live.pathname.replace(/\/$/, "");
    return `${live.origin}${path}`;
  } catch { return null; }
}

/** Public wall row. Missing consent, a private repo, or a non-https live URL drops the entry. */
export function rescueEntry(input: {
  consent: boolean; isPrivate: boolean; repo: string; error: string; liveUrl: string; prUrl: string; fixedAt: string;
}): RescueEntry | null {
  if (!input.consent || input.isPrivate) return null;
  if (!REPO.test(input.repo) || !PR.test(input.prUrl)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(input.fixedAt)) return null;
  let live: URL;
  try { live = new URL(input.liveUrl); } catch { return null; }
  if (live.protocol !== "https:" || live.username || live.password || live.hostname === "github.com" || live.hostname === "www.github.com") return null;
  const error = input.error.replace(SECRET, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 280);
  if (error.length < 8) return null;
  const path = live.pathname === "/" ? "" : live.pathname.replace(/\/$/, "");
  return { repo: input.repo, error, liveUrl: `${live.origin}${path}`, prUrl: input.prUrl, fixedAt: input.fixedAt };
}
