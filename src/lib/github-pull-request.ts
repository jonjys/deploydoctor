import "server-only";
import { analyzeGitHubRepository, githubRequest, GitHubApiError, parseGitHubRepoUrl } from "@/lib/github";
import { comparePullRequest } from "@/lib/pr-impact";

type Options = Parameters<typeof analyzeGitHubRepository>[1] & { expectedHeadSha?: string };
type PullRequest = { number: number; base: { ref: string; sha: string; repo: { full_name: string; private: boolean } }; head: { sha: string; repo: { full_name: string } | null } };
type Comparison = { merge_base_commit: { sha: string }; files?: Array<{ status: string; filename: string; previous_filename?: string }> };
const SHA = /^[a-f0-9]{40}$/i;
const deps = { request: githubRequest, scan: analyzeGitHubRepository };

/** Two bounded, immutable snapshots through the existing scanner. No second scanning engine or persistence path. */
export async function analyzeGitHubPullRequest(repoUrl: string, number: number, options: Options = {}, backend = deps) {
  if (!Number.isSafeInteger(number) || number < 1) throw new GitHubApiError("Enter a valid pull request number.", 400);
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(repoUrl);
  const repository = `${owner}/${name}`, repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = options.privateToken || process.env.GITHUB_TOKEN, userToken = Boolean(options.privateToken);
  let pr: PullRequest;
  try {
    pr = await backend.request<PullRequest>(`${repoPath}/pulls/${number}`, token, userToken);
  } catch (error) {
    // A service fine-grained token may read contents but not PR metadata, even for public repos.
    // Retry public metadata anonymously only after proving the repository is public. Never retry a
    // buyer's credential or any rate-limit/authorization error through another identity.
    if (!(error instanceof GitHubApiError) || error.status !== 404 || userToken || !token) {
      if (error instanceof GitHubApiError && error.status === 404 && !userToken) throw new GitHubApiError("GitHub could not find or expose this pull request. Verify its number and repository; no private pass is required for a public PR.", 404);
      throw error;
    }
    const repositoryInfo = await backend.request<{ private: boolean }>(repoPath, token, false);
    if (repositoryInfo.private !== false) throw error;
    try { pr = await backend.request<PullRequest>(`${repoPath}/pulls/${number}`, undefined, false); }
    catch (publicError) {
      if (publicError instanceof GitHubApiError && publicError.status === 404) throw new GitHubApiError("GitHub could not find or expose this public pull request. Verify its number and repository.", 404);
      throw publicError;
    }
  }
  if (pr.number !== number || pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()
    || pr.head?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new GitHubApiError("Fork pull requests are not supported for comparison yet. Scan the head repository directly.", 422);
  }
  if (pr.base.repo.private && !userToken) throw new GitHubApiError("Private pull requests need an authorized GitHub connection and an active pass.", 400, "gh.privateOnly");
  if (!SHA.test(pr.base.sha) || !SHA.test(pr.head.sha) || typeof pr.base.ref !== "string" || pr.base.ref.length > 255) throw new GitHubApiError("Invalid pull request revision.", 502);
  if (options.expectedHeadSha && options.expectedHeadSha.toLowerCase() !== pr.head.sha.toLowerCase()) throw new GitHubApiError("The PR head changed. Retry on the current commit; no report was saved.", 409);
  const comparison = await backend.request<Comparison>(`${repoPath}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`, token, userToken);
  const baseSha = comparison.merge_base_commit?.sha;
  if (!SHA.test(baseSha ?? "")) throw new GitHubApiError("Could not establish a common PR base.", 422);
  // Parallel downloads are subject to the existing site-wide download semaphore and GitHub budgets.
  // Explicit categories run on both snapshots. Otherwise their real applicable checks are compared conservatively.
  const [base, head] = await Promise.all([
    backend.scan(canonicalUrl, { ...options, ref: baseSha }),
    backend.scan(canonicalUrl, { ...options, ref: pr.head.sha }),
  ]);
  const renames: Record<string, string> = Object.create(null);
  for (const f of comparison.files ?? []) if (f.status === "renamed" && f.previous_filename) renames[f.previous_filename] = f.filename;
  // GitHub returns at most 300 changed files. At that boundary rename coverage cannot be proven.
  const complete = Array.isArray(comparison.files) && comparison.files.length < 300;
  const impact = comparePullRequest(base.results, head.results, { number, url: `${canonicalUrl}/pull/${number}`, baseRef: pr.base.ref,
    baseCommitSha: baseSha, headCommitSha: pr.head.sha }, renames, complete);
  return { ...head, isPrivate: base.isPrivate || head.isPrivate, results: { ...head.results, pullRequest: impact } };
}
