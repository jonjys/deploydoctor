// deploydoctor.nyttolabs.com/owner/repo works like github.com/owner/repo: swap the host and the scan starts.

/** A GitHub login: letters, digits and hyphens (underscores for managed users), never a leading dot or underscore. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * First path segments that are never a repository owner here: this app's own top-level routes, so
 * /api/x/y or /r/id/x still 404, and GitHub's own pages, so /orgs/vercel/repositories is not scanned as a repo.
 */
const RESERVED = new Set([
  "account", "ai-plugin", "api", "checkout", "ci", "diagnose", "guides", "patch", "pricing", "r", "restore", "social",
  "about", "advisories", "apps", "codespaces", "collections", "contact", "customer-stories", "enterprise", "enterprises",
  "explore", "features", "issues", "login", "marketplace", "new", "notifications", "orgs", "organizations", "pulls",
  "readme", "search", "security", "sessions", "settings", "signup", "site", "solutions", "sponsors", "stars", "topics",
  "trending", "users",
  // The page the Watch this repo email links land on.
  "watch",
]);

/** Where a path that names no repository is sent: one segment matches no route, so it renders the app's not-found page. */
export const NOT_FOUND_PATH = "/404";

/**
 * owner/name from the path segments after the host, or null when they do not name a repository.
 * Accepts a pasted github.com/ or https://github.com/ prefix, drops .git and anything after the repo (/tree/main, /pulls).
 */
export function repoFromPath(segments: readonly string[]): string | null {
  const path = segments.join("/");
  const match = /^(?:(?:https?:\/+)?(?:www\.)?github\.com\/)?([^/]+)\/([^/]+)/i.exec(path);
  if (!match) return null;
  const owner = match[1];
  const name = match[2].replace(/(?:\.git)+$/i, "");
  if (!OWNER.test(owner) || RESERVED.has(owner.toLowerCase())) return null;
  if (!NAME.test(name) || /^\.{1,2}$/.test(name)) return null;
  return `${owner}/${name}`;
}
