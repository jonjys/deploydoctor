import "server-only";
import { randomUUID } from "node:crypto";
import type { RepositorySnapshot } from "@/lib/analyzer";
import { analyzeGitHubRepository, githubRequest, GitHubApiError, parseGitHubRepoUrl, type GitBlob, type GitTree } from "@/lib/github";
import { MAX_PATCH_SOURCE_BYTES } from "@/lib/patch/case-patch";
import { planDeployFixes } from "@/lib/fix-pr/deploy-fixes";
import { sealQuote } from "@/lib/patch/quote";
import { signingSecret } from "@/lib/session-token";
import type { ReportResults } from "@/types/report";
import { diagnosisItems, publicFixes, summarizeError, type DiagnosisItem } from "@/lib/fix-pr/offer";

export type PreparedFix = {
  eligible: boolean;
  repoUrl: string;
  isPrivate: boolean;
  headline: string;
  items: DiagnosisItem[];
  fixes: { file: string; line: number; problem: string }[];
  quoteToken?: string;
  commitSha?: string;
  errorSummary: string;
};

const MAX_FILES = 12;

/**
 * Free diagnosis of one repository, then a verified import-case patch when one exists.
 * The patch itself is only inside the sealed quote. Callers must not add it to the response.
 */
export async function prepareRepositoryFix(repo: string, token?: string): Promise<PreparedFix> {
  const { owner, name, canonicalUrl } = parseGitHubRepoUrl(`https://github.com/${repo}`);
  let analyzed: Awaited<ReturnType<typeof analyzeGitHubRepository>>;
  try {
    analyzed = await analyzeGitHubRepository(canonicalUrl, { privateToken: token });
  } catch (error) {
    if (error instanceof GitHubApiError && error.key === "gh.privateOnly") {
      return { eligible: false, repoUrl: canonicalUrl, isPrivate: true, headline: "This repository is private.", items: [], fixes: [], errorSummary: "Connect GitHub to diagnose a private repository." };
    }
    throw error;
  }
  const items = diagnosisItems(analyzed.results.checks);
  const headline = items[0]?.title ?? "No failing checks in the scanned commit";
  const errorSummary = summarizeError(items);
  const commitSha = analyzed.results.repository.commitSha;
  if (!commitSha || !/^[a-f0-9]{40}$/.test(commitSha)) {
    return { eligible: false, repoUrl: analyzed.canonicalUrl, isPrivate: analyzed.isPrivate, headline, items, fixes: [], commitSha, errorSummary };
  }
  const plan = await planAtCommit(owner, name, analyzed.results.repository.defaultBranch, commitSha, analyzed.results, token);
  if (!plan.fixes.length || !plan.patch) {
    return { eligible: false, repoUrl: analyzed.canonicalUrl, isPrivate: analyzed.isPrivate, headline, items, fixes: [], commitSha, errorSummary };
  }
  const { token: quoteToken } = sealQuote({
    reportId: randomUUID(), repoUrl: analyzed.canonicalUrl, commitSha, files: plan.files,
    fixes: plan.fixes.length, patch: plan.patch, sourceHashes: plan.sourceHashes, notes: plan.notes.slice(0, 2_000),
  }, signingSecret());
  return {
    eligible: true, repoUrl: analyzed.canonicalUrl, isPrivate: analyzed.isPrivate, headline, items,
    fixes: publicFixes(plan), quoteToken, commitSha, errorSummary,
  };
}

async function planAtCommit(owner: string, name: string, defaultBranch: string, commitSha: string, results: ReportResults, token?: string) {
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const tree = await githubRequest<GitTree>(`${repoPath}/git/trees/${commitSha}?recursive=1`, token, Boolean(token));
  if (tree.truncated || tree.tree.length > 30_000) return planDeployFixes(emptySnapshot(owner, name, defaultBranch));
  const flagged = results.checks.flatMap((check) => [...(check.findings ?? []).map((finding) => finding.file), check.suggestedFile?.path ?? ""]).filter(Boolean);
  const configs = tree.tree.filter((entry) => entry.type === "blob" && /^(?:next|vite)\.config\.[cm]?[jt]s$|(?:^|\/)(?:tsconfig|jsconfig)\.json$|^supabase\/config\.toml$/.test(entry.path)).map((entry) => entry.path);
  const wanted = new Set([...flagged.slice(0, MAX_FILES), ...configs, "package.json", ".gitignore", ".env.example", ".nvmrc", "vercel.json", "supabase/config.toml"]);
  const blobs = tree.tree.filter((entry) => entry.type === "blob" && entry.mode !== "120000" && wanted.has(entry.path) && (entry.size ?? 0) <= MAX_PATCH_SOURCE_BYTES);
  const contents = new Map<string, string>();
  await Promise.all(blobs.map(async (entry) => {
    const blob = await githubRequest<GitBlob>(`${repoPath}/git/blobs/${entry.sha}`, token, Boolean(token));
    if (blob.encoding !== "base64") return;
    const bytes = Buffer.from(blob.content.replace(/\n/g, ""), "base64");
    const source = bytes.toString("utf8");
    if (bytes.length <= MAX_PATCH_SOURCE_BYTES && !source.includes("\uFFFD")) contents.set(entry.path, source);
  }));
  const entries = tree.tree.filter((entry): entry is typeof entry & { type: "blob" | "tree" } => (entry.type === "blob" && entry.mode !== "120000") || entry.type === "tree")
    .map(({ path, type, size }) => ({ path, type, size }));
  const snapshot: RepositorySnapshot = {
    owner, name, defaultBranch, entries, contents, sourceFilesFound: contents.size, sourceFilesRead: contents.size, partial: false,
  };
  return planDeployFixes(snapshot);
}

function emptySnapshot(owner: string, name: string, defaultBranch: string): RepositorySnapshot {
  return { owner, name, defaultBranch, entries: [], contents: new Map(), sourceFilesFound: 0, sourceFilesRead: 0, partial: false };
}
