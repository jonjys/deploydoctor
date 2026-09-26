import "server-only";

import { analyzeSnapshot, type RepositorySnapshot } from "@/lib/analyzer";
import type { ReportResults } from "@/types/report";

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

async function githubRequest<T>(pathname: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
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
  if (/^(?:tsconfig|jsconfig)\.json$/.test(pathname)) return 2;
  if (API_ROUTE.test(pathname)) return 3;
  if (/(?:^|\/)(?:src\/)?app\/.*\/(?:page|layout|loading|default|not-found)\.[jt]sx$/i.test(pathname)) return 4;
  return 5;
}

export async function analyzeGitHubRepository(repoUrl: string): Promise<{
  canonicalUrl: string;
  results: ReportResults;
}> {
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const repository = await githubRequest<GitHubRepository>(repoPath);
  if (repository.private) {
    throw new GitHubApiError("DeployDoctor only scans public repositories.", 400);
  }

  const tree = await githubRequest<GitTree>(
    `${repoPath}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
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
          /(?:^|\/)\.env(?:\..+)?$/.test(entry.path)),
    )
    .sort((left, right) => priorityFor(left.path) - priorityFor(right.path) || left.path.localeCompare(right.path));
  const requestLimit = process.env.GITHUB_TOKEN ? 180 : 48;
  const selected = interesting.slice(0, requestLimit);
  const contents = new Map<string, string>();
  let readFailures = 0;

  for (let start = 0; start < selected.length; start += 8) {
    const batch = selected.slice(start, start + 8);
    const loaded = await Promise.all(
      batch.map(async (entry) => {
        try {
          const blob = await githubRequest<GitBlob>(`${repoPath}/git/blobs/${entry.sha}`);
          if (blob.encoding !== "base64") throw new Error("Unsupported blob encoding");
          return [entry.path, Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8")] as const;
        } catch {
          readFailures += 1;
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
    partial:
      tree.truncated ||
      readFailures > 0 ||
      sourceFilesRead < sourceFiles.length ||
      sourceFiles.some((entry) => (entry.size ?? 0) > MAX_FILE_BYTES),
  };

  return { canonicalUrl, results: analyzeSnapshot(snapshot) };
}
