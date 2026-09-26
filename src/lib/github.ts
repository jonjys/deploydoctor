import "server-only";

import { analyzeSnapshot, type RepositorySnapshot } from "@/lib/analyzer";
import { detectStack, type Stack } from "@/lib/stack";
import type { Category, ReportResults } from "@/types/report";

const GITHUB_API = "https://api.github.com";
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const API_ROUTE = /(?:^|\/)(?:src\/)?app\/api(?:\/.*)?\/route\.[cm]?[jt]s$|(?:^|\/)(?:src\/)?pages\/api\/.*\.[cm]?[jt]s$/i;
const MAX_FILE_BYTES = 256_000;

type GitHubRepository = {
  default_branch: string;
  private: boolean;
};

type GitTree = {
  truncated: boolean;
  tree: Array<{
    path: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
  }>;
};

type GitBlob = {
  content: string;
  encoding: "base64" | string;
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
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
    throw new GitHubApiError("Enter a full public GitHub repository URL.", 400);
  }

  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
    throw new GitHubApiError("Enter an https://github.com/owner/repository URL.", 400);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new GitHubApiError("Enter the repository URL, without a branch or file path.", 400);
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !name || !validPart.test(owner) || !validPart.test(name)) {
    throw new GitHubApiError("That GitHub repository URL is not valid.", 400);
  }

  return { owner, name, canonicalUrl: `https://github.com/${owner}/${name}` };
}

async function githubRequest<T>(pathname: string, token?: string): Promise<T> {
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
    if (response.status === 404) {
      throw new GitHubApiError("Repository not found; make sure it is public and the URL is correct.", 404);
    }
    if (response.status === 403 || response.status === 429) {
      throw new GitHubApiError("GitHub's API rate limit was reached; add GITHUB_TOKEN or try again later.", 429);
    }
    throw new GitHubApiError(`GitHub returned an unexpected ${response.status} response.`, 502);
  }

  return (await response.json()) as T;
}

function priorityFor(pathname: string): number {
  if (pathname === "package.json") return 0;
  if (/(?:^|\/)\.env(?:\..+)?$/.test(pathname)) return 1;
  if (/^(?:tsconfig|jsconfig)\.json$/.test(pathname) || /\.prisma$/.test(pathname)) return 2;
  if (API_ROUTE.test(pathname)) return 3;
  if (/(?:^|\/)(?:src\/)?app\/.*\/(?:page|layout|loading|default|not-found)\.[jt]sx$/i.test(pathname)) return 4;
  return 5;
}

export async function analyzeGitHubRepository(repoUrl: string, options: { privateToken?: string; checks?: Category[] } = {}): Promise<{
  canonicalUrl: string;
  results: ReportResults;
  isPrivate: boolean;
}> {
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = options.privateToken || process.env.GITHUB_TOKEN;
  const repository = await githubRequest<GitHubRepository>(repoPath, token);
  if (repository.private && !options.privateToken) {
    throw new GitHubApiError("DeployDoctor only scans public repositories.", 400);
  }

  const tree = await githubRequest<GitTree>(
    `${repoPath}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`, token,
  );
  const entries = tree.tree
    .filter((entry): entry is typeof entry & { type: "blob" | "tree" } =>
      entry.type === "blob" || entry.type === "tree",
    )
    .map(({ path, type, size }) => ({ path, type, size }));
  const sourceFiles = tree.tree.filter(
    (entry) => entry.type === "blob" && SOURCE_FILE.test(entry.path),
  );
  const interesting = tree.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        (entry.size ?? 0) <= MAX_FILE_BYTES &&
        (SOURCE_FILE.test(entry.path) ||
          entry.path === "package.json" ||
          /^(?:tsconfig|jsconfig)\.json$/.test(entry.path) ||
          /\.prisma$/.test(entry.path) ||
          /(?:^|\/)\.env(?:\..+)?$/.test(entry.path)),
    )
    .sort((left, right) => priorityFor(left.path) - priorityFor(right.path) || left.path.localeCompare(right.path));
  const requestLimit = token ? 180 : 48;
  const selected = interesting.slice(0, requestLimit);
  const contents = new Map<string, string>();
  let readFailures = 0;
  const reasons = new Set<string>();
  const started = Date.now();
  if (tree.truncated) reasons.add("truncated_tree");
  if (interesting.length > requestLimit) reasons.add("file_limit");
  if (sourceFiles.some((entry) => (entry.size ?? 0) > MAX_FILE_BYTES)) reasons.add("file_size");

  for (let start = 0; start < selected.length; start += 8) {
    if (Date.now() - started > 35_000) { reasons.add("time_limit"); break; }
    if (reasons.has("rate_limit")) break;
    const batch = selected.slice(start, start + 8);
    const loaded = await Promise.all(
      batch.map(async (entry) => {
        try {
          const blob = await githubRequest<GitBlob>(`${repoPath}/git/blobs/${entry.sha}`, token);
          if (blob.encoding !== "base64") throw new Error("Unsupported blob encoding");
          return [entry.path, Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8")] as const;
        } catch (error) {
          readFailures += 1;
          reasons.add(error instanceof GitHubApiError && error.status === 429 ? "rate_limit" : "read_error");
          return null;
        }
      }),
    );
    for (const item of loaded) if (item) contents.set(item[0], item[1]);
  }

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
      tree.truncated ||
      readFailures > 0 ||
      sourceFilesRead < sourceFiles.length ||
      sourceFiles.some((entry) => (entry.size ?? 0) > MAX_FILE_BYTES),
  };

  return { canonicalUrl, results: analyzeSnapshot(snapshot, { checks: options.checks }), isPrivate: repository.private };
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
  const repository = await githubRequest<GitHubRepository>(repoPath, token);
  if (repository.private && !options.privateToken) {
    throw new GitHubApiError("DeployDoctor only scans public repositories.", 400);
  }
  const [packageJson, envText] = await Promise.all([
    readRootFile(repoPath, "package.json", token),
    readRootFile(repoPath, ".env.example", token),
  ]);
  return { canonicalUrl, stack: detectStack({ packageJson, envText }) };
}
