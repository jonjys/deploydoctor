import "server-only";
import { boundedBody } from "@/lib/bounded-body";
import { db, query } from "@/lib/db";
import { digest } from "@/lib/session-token";
import { readRepositoryArchive } from "@/lib/repository-archive";
import { acquireWork, releaseWork } from "@/lib/work-budget";
import { githubRules } from "@/lib/budget-policy";

import { analyzeSnapshot, MISNAMED_ENV_TEMPLATE, type RepositorySnapshot } from "@/lib/analyzer";
import { detectStack, type Stack } from "@/lib/stack";
import { MIGRATION_FILE } from "@/lib/supabase-sql";
import { githubFailure } from "@/lib/github-status";
import { t, type Lang, type MessageKey } from "@/lib/i18n";
import type { Category, ReportResults } from "@/types/report";

const GITHUB_API = "https://api.github.com";
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const ASTRO_PAGE = /^src\/pages\/.*\.astro$/i;
const API_ROUTE = /(?:^|\/)(?:src\/)?app\/api(?:\/.*)?\/route\.[cm]?[jt]s$|(?:^|\/)(?:src\/)?pages\/api\/.*\.[cm]?[jt]s$/i;
const MAX_FILE_BYTES = 256_000;
// Root lockfiles are read in full (they can be large) so the dependencies check can compare them with package.json.
const ROOT_LOCKFILE = /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock)$/;
const MAX_LOCKFILE_BYTES = 8_000_000;

type GitHubRepository = {
  default_branch: string;
  pushed_at?: string | null;
  private: boolean;
};

export type GitTree = {
  truncated: boolean;
  tree: Array<{
    path: string;
    type: "blob" | "tree" | "commit";
    mode?: string;
    sha: string;
    size?: number;
  }>;
};

export type GitBlob = {
  content: string;
  encoding: "base64" | string;
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly key?: MessageKey,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }

  /** The message in the visitor's language; the English `message` stays for logs. */
  localized(lang: Lang) {
    return this.key ? t(lang, this.key, { status: this.status }) : this.message;
  }
}

export function parseGitHubRepoUrl(input: string): {
  owner: string;
  name: string;
  canonicalUrl: string;
} {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new GitHubApiError("Enter a full public GitHub repository URL.", 400, "gh.urlInvalid");
  }

  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
    throw new GitHubApiError("Enter an https://github.com/owner/repository URL.", 400, "gh.urlHost");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new GitHubApiError("Enter the repository URL, without a branch or file path.", 400, "gh.urlPath");
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !name || !validPart.test(owner) || !validPart.test(name)) {
    throw new GitHubApiError("That GitHub repository URL is not valid.", 400, "gh.urlPart");
  }

  return { owner, name, canonicalUrl: `https://github.com/${owner}/${name}` };
}

/** `userToken`: the token is the buyer's own, so a 401, 403 or 404 means it cannot read the repository. */
export async function githubRequest<T>(pathname: string, token?: string, userToken = false): Promise<T> {
  if (token && token === process.env.GITHUB_TOKEN) await acquireWork(githubRules());
  const response = await fetch(`${GITHUB_API}${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "DeployDoctor",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // GitHub also answers 403 for primary (remaining 0) and secondary (Retry-After) rate limits.
    const rateLimited = response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    const failure = githubFailure(response.status, { userToken, rateLimited });
    throw new GitHubApiError(failure.message, failure.status, failure.key);
  }

  try {
    return JSON.parse(await boundedBody(response, 6_000_000)) as T;
  } catch {
    throw new GitHubApiError("GitHub response exceeded safe limits or was invalid.", 422, "gh.archiveLimit");
  }
}

/** Immutable snapshot resolution, also used by patch preparation. No branch is read again after this. */
export async function resolveCommitSha(repoPath: string, ref: string, token?: string, userToken = false): Promise<string> {
  const commit = await githubRequest<{ sha: string }>(`${repoPath}/commits/${encodeURIComponent(ref)}`, token, userToken)
    .catch((error: unknown) => {
      if (error instanceof GitHubApiError && error.status === 404) throw new GitHubApiError("The scanned revision was not found.", 404, "gh.refNotFound");
      throw error;
    });
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new GitHubApiError("Unexpected commit reference.", 502);
  return commit.sha;
}

function priorityFor(pathname: string): number {
  if (pathname === "package.json") return 0;
  if (/(?:^|\/)\.env(?:\..+)?$/.test(pathname) || MISNAMED_ENV_TEMPLATE.test(pathname) || pathname === ".gitignore") return 1;
  if (/(?:^|\/)(?:tsconfig|jsconfig)\.json$|^vercel\.json$/.test(pathname) || /\.prisma$/.test(pathname) || ROOT_LOCKFILE.test(pathname)
    || /^(?:next|svelte|astro|vite)\.config\.[cm]?[jt]s$/.test(pathname)) return 2;
  if (API_ROUTE.test(pathname)) return 3;
  if (MIGRATION_FILE.test(pathname)) return 4;
  if (/(?:^|\/)(?:src\/)?app\/.*\/(?:page|layout|loading|default|not-found)\.[jt]sx$/i.test(pathname)) return 4;
  return 5;
}

export async function analyzeGitHubRepository(repoUrl: string, options: { privateToken?: string; checks?: Category[]; lang?: Lang; ref?: string } = {}): Promise<{
  canonicalUrl: string;
  results: ReportResults;
  isPrivate: boolean;
}> {
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = options.privateToken || process.env.GITHUB_TOKEN;
  const userToken = Boolean(options.privateToken);
  const repository = await githubRequest<GitHubRepository>(repoPath, token, userToken);
  if (repository.private && !options.privateToken) {
    throw new GitHubApiError("DeployDoctor only scans public repositories.", 400, "gh.privateOnly");
  }

  // CI scans the pull request head; the website scans the default branch.
  const ref = options.ref && options.ref !== repository.default_branch ? options.ref : undefined;
  // Resolve once, then read only this immutable commit (including the archive and cache key).
  const commitSha = await resolveCommitSha(repoPath, ref ?? repository.default_branch, token, userToken);
  const cacheKey = !options.privateToken && !repository.private && commitSha
    ? digest(JSON.stringify(["scan-v3", owner.toLowerCase(), name.toLowerCase(), commitSha, ref ?? "", [...(options.checks ?? [])].sort(), options.lang ?? "en"])) : null;
  if (cacheKey) {
    const rows = await db<Array<{ results: ReportResults }>>(query("public_scan_cache", {
      key: `eq.${cacheKey}`, expires_at: `gt.${new Date().toISOString()}`, select: "results", limit: "1",
    })).catch(() => []);
    if (rows[0]) return { canonicalUrl, results: rows[0].results, isPrivate: false };
  }
  const lease = await acquireWork([], "repository-download", 3, 50);
  let archive;
  try {
    const archivePath = `${repoPath}/tarball/${commitSha}`;
    if (token && token === process.env.GITHUB_TOKEN) await acquireWork(githubRules());
    const redirect = await fetch(`${GITHUB_API}${archivePath}`, {
      headers: { "User-Agent": "DeployDoctor", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: "manual", signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (redirect.status !== 302) {
      if (ref && redirect.status === 404) throw new GitHubApiError(`Branch or commit "${ref}" was not found in the repository.`, 404, "gh.refNotFound");
      const rateLimited = redirect.headers.get("x-ratelimit-remaining") === "0" || redirect.headers.has("retry-after");
      const failure = githubFailure(redirect.status, { userToken, rateLimited });
      throw new GitHubApiError(failure.message, failure.status, failure.key);
    }
    const location = new URL(redirect.headers.get("location") ?? "");
    if (location.protocol !== "https:" || location.hostname !== "codeload.github.com" || location.username || location.password || location.port) {
      throw new Error("Unexpected repository archive host.");
    }
    // The signed redirect is sufficient for private archives; never forward our token to another host.
    const signal = AbortSignal.timeout(35_000);
    const downloaded = await fetch(location, { redirect: "error", cache: "no-store", signal });
    if (!downloaded.ok || !downloaded.body) throw new Error("Could not download repository archive.");
    archive = await readRepositoryArchive(downloaded.body, (file, size) =>
      (ROOT_LOCKFILE.test(file) && size <= MAX_LOCKFILE_BYTES) || (size <= MAX_FILE_BYTES &&
      // Nested tsconfig files resolve a nested app's aliases; Astro pages can opt out of prerendering in their frontmatter.
      (SOURCE_FILE.test(file) || /^(?:package|vercel)\.json$/.test(file) || /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(file) || ASTRO_PAGE.test(file) || file === ".gitignore"
        || /\.prisma$/.test(file) || MIGRATION_FILE.test(file) || MISNAMED_ENV_TEMPLATE.test(file) || /(?:^|\/)\.env(?:\..+)?$/.test(file))), priorityFor, signal);
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    throw new GitHubApiError("Repository archive could not be read within safety limits.", 422, "gh.archiveLimit");
  } finally {
    if (lease) await releaseWork(lease);
  }
  const { entries, contents } = archive;
  const sourceFiles = entries.filter(entry => entry.type === "blob" && SOURCE_FILE.test(entry.path));
  const reasons = new Set<string>();
  if (archive.truncated) reasons.add("file_limit");
  if (sourceFiles.some(entry => (entry.size ?? 0) > MAX_FILE_BYTES)) reasons.add("file_size");
  const readFailures = 0;

  const sourceFilesRead = [...contents.keys()].filter((pathname) => SOURCE_FILE.test(pathname)).length;
  const snapshot: RepositorySnapshot = {
    owner,
    name,
    defaultBranch: repository.default_branch,
    entries,
    contents,
    sourceFilesFound: sourceFiles.length,
    sourceFilesRead,
    partialReasons: [...reasons],
    partial:
      archive.truncated ||
      readFailures > 0 ||
      sourceFilesRead < sourceFiles.length ||
      sourceFiles.some((entry) => (entry.size ?? 0) > MAX_FILE_BYTES),
  };

  const results = analyzeSnapshot(snapshot, { checks: options.checks, lang: options.lang });
  results.repository.commitSha = commitSha;
  if (ref) results.repository.ref = ref;
  if (cacheKey && !snapshot.partial) {
    await db(query("public_scan_cache", { on_conflict: "key" }), { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: cacheKey, results, expires_at: new Date(Date.now() + 120_000).toISOString() }),
    }).catch(() => console.error("Public scan cache write failed"));
  }
  return { canonicalUrl, results, isPrivate: repository.private };
}

async function readRootFile(repoPath: string, file: string, token?: string): Promise<string | null> {
  try {
    const data = await githubRequest<{ content?: string; encoding?: string }>(`${repoPath}/contents/${file}`, token);
    if (data.encoding !== "base64" || typeof data.content !== "string") return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch (error) {
    // A missing file is normal; rate limits and other failures must surface.
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/** Cheap pre-scan detection: repository metadata plus root package.json and .env.example only. */
export async function detectRepositoryStack(repoUrl: string, options: { privateToken?: string } = {}): Promise<{ canonicalUrl: string; stack: Stack }> {
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = options.privateToken || process.env.GITHUB_TOKEN;
  const repository = await githubRequest<GitHubRepository>(repoPath, token, Boolean(options.privateToken));
  if (repository.private && !options.privateToken) {
    throw new GitHubApiError("DeployDoctor only scans public repositories.", 400, "gh.privateOnly");
  }
  const [packageJson, envText] = await Promise.all([
    readRootFile(repoPath, "package.json", token),
    readRootFile(repoPath, ".env.example", token),
  ]);
  return { canonicalUrl, stack: detectStack({ packageJson, envText }) };
}
