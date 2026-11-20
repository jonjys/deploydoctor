import "server-only";
import { downloadRepositoryArchive, githubRequest, parseGitHubRepoUrl, resolveCommitSha, GitHubApiError } from "@/lib/github";
import { repoFromPath } from "@/lib/repo-link";
import { storeRepoSafety } from "@/lib/repo-safety-store";
import { analyzeRepoSafety, SAFETY_FILE, safetyPriority, type RepoSafetyReport } from "@/lib/repo-safety";

const MAX_FILE_BYTES = 400_000;

/** Public repositories only. One metadata call, one owner call, one commit lookup and one tarball. */
export async function checkRepoSafety(repoUrl: string): Promise<RepoSafetyReport> {
  // People paste github.com/owner/name, owner/name or a link to a release or file: all name the same repository.
  const named = repoFromPath([repoUrl.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")]);
  const { owner, name } = parseGitHubRepoUrl(named ? `https://github.com/${named}` : repoUrl.trim());
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const token = process.env.GITHUB_TOKEN;
  const repo = await githubRequest<{ full_name: string; default_branch: string; private: boolean; created_at?: string; stargazers_count?: number; archived?: boolean; fork?: boolean; owner?: { login?: string; type?: string } }>(repoPath, token);
  if (repo.private) throw new GitHubApiError("Only public repositories can be checked.", 400, "gh.privateOnly");
  const ownerInfo = repo.owner?.login ? await githubRequest<{ created_at?: string }>(`/users/${encodeURIComponent(repo.owner.login)}`, token).catch(() => null) : null;
  const sha = await resolveCommitSha(repoPath, repo.default_branch, token);
  const archive = await downloadRepositoryArchive(repoPath, sha, token, false, undefined, (file, size) => size <= MAX_FILE_BYTES && SAFETY_FILE.test(file), safetyPriority);
  const report = analyzeRepoSafety({ repo: repo.full_name, entries: archive.entries, contents: archive.contents, partial: archive.truncated,
    meta: { fullName: repo.full_name, createdAt: repo.created_at, stars: repo.stargazers_count, ownerCreatedAt: ownerInfo?.created_at, archived: repo.archived, fork: repo.fork } });
  const result = { ...report, checkedAt: new Date().toISOString(), commit: sha.slice(0, 7) };
  await storeRepoSafety(result);
  return result;
}
