import { applyVerifiedDiff, MAX_PATCH_SOURCE_BYTES, PatchError, sourceHash } from "@/lib/patch/case-patch";
import { statusRepository } from "@/lib/repo-status";

export type PrOrder = { repoUrl: string; commitSha: string; patch: string; files: string[]; sourceHashes?: Record<string, string>; reportId: string };
export type GitRequest = <T>(path: string, method?: "GET" | "POST", body?: unknown) => Promise<T>;
const SHA = /^[a-f0-9]{40}$/;
const safeFile = (path: string) => /^[\w./@()[\]$+~-]{1,220}\.[cm]?[jt]sx?$/.test(path) && !path.startsWith("/") && path.split("/").every(part => part && part !== "." && part !== "..");

/** The same fresh payment/owner gate as downloading. No GitHub request precedes authorization. */
export async function openPaidPatchPullRequest(sessionId: string, keys: string[], branchKey: string,
  loadOrder: (id: string, keys: string[]) => Promise<PrOrder>, api: GitRequest) {
  const order = await loadOrder(sessionId, keys);
  return openPatchPullRequest(order, branchKey, api);
}

/** Pure full-context application. One diff for each paid file; no shell, repo code or AI. */
export function paidPatchFiles(order: PrOrder, originals: Map<string, string>) {
  if (!SHA.test(order.commitSha) || !order.files.length || order.files.length > 12 || new Set(order.files).size !== order.files.length || order.files.some(file => !safeFile(file)))
    throw new PatchError("This order cannot be opened as a pull request.", 422, "path");
  const diffs = order.patch.split(/(?=^diff --git )/m).filter(Boolean);
  if (diffs.length !== order.files.length) throw new PatchError("The patch does not match the paid files.", 422, "verify");
  const used = new Set<string>();
  return diffs.map(diff => {
    const file = order.files.find(path => diff.startsWith(`diff --git a/${path} b/${path}\n`));
    if (!file || used.has(file)) throw new PatchError("The patch paths do not match the order.", 422, "verify");
    used.add(file);
    const source = originals.get(file);
    if (source === undefined || Buffer.byteLength(source) > MAX_PATCH_SOURCE_BYTES || !order.sourceHashes?.[file] || sourceHash(source) !== order.sourceHashes[file])
      throw new PatchError("Source changed or the order is too old. Download the patch for manual review.", 409, "version");
    return { file, content: applyVerifiedDiff(file, source, diff) };
  });
}

type Pull = { html_url: string; state: string; draft: boolean };
function checkedPull(pr: Pull, repoUrl: string) {
  if (!new RegExp(`^${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/[0-9]+$`, "i").test(pr.html_url)) throw new Error("Unexpected GitHub pull request URL");
  return { url: pr.html_url, state: pr.state, draft: pr.draft };
}

export type PullRequestText = { branch: string; commitMessage: string; title: string; body: string; draft: boolean; allowPrivate?: boolean };

/**
 * A new deterministic branch. Default branch and source blobs must match the paid commit.
 * Retries return the same PR, including a closed PR; no branch is ever force-updated.
 * The import-patch defaults stay a draft on `deploydoctor/imports-`. Fix PR passes its own text.
 */
export async function openPatchPullRequest(order: PrOrder, branchKey: string, api: GitRequest, text?: PullRequestText) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(order.repoUrl);
  const repo = match && statusRepository(match[1], match[2]);
  const branch = text?.branch ?? `deploydoctor/imports-${branchKey}`;
  if (!repo || !/^[a-f0-9]{24}$/.test(branchKey) || !SHA.test(order.commitSha) || !/^deploydoctor\/(?:imports|fix)-[a-f0-9]{24}$/.test(branch))
    throw new PatchError("Invalid patch repository.", 422, "path");
  const root = `/repos/${repo.owner}/${repo.name}`;
  const repository = await api<{ full_name: string; default_branch: string; private: boolean; archived: boolean; permissions?: { push?: boolean } }>(root);
  if (repository.archived || repository.full_name.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase() || !repository.permissions?.push || (repository.private && !text?.allowPrivate))
    throw new PatchError(text?.allowPrivate
      ? "GitHub access cannot push to this repository. Reconnect the Fix app with Contents and Pull requests write."
      : "Use a token with Contents and Pull requests write access to this public repository.", 403, "access");
  const pulls = await api<Pull[]>(`${root}/pulls?state=all&head=${encodeURIComponent(`${repo.owner}:${branch}`)}&per_page=1`);
  if (pulls[0]) return { ...checkedPull(pulls[0], order.repoUrl), reused: true };

  const baseRef = `${root}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`;
  const assertBase = async () => {
    const ref = await api<{ object: { sha: string } }>(baseRef);
    if (ref.object.sha !== order.commitSha) throw new PatchError("The default branch changed since this scan. Rescan before opening a pull request.", 409, "version");
  };
  await assertBase();
  const commit = await api<{ tree: { sha: string } }>(`${root}/git/commits/${order.commitSha}`);
  if (!SHA.test(commit.tree.sha)) throw new PatchError("Unexpected source tree.", 422, "verify");
  const tree = await api<{ truncated: boolean; tree: Array<{ path: string; type: string; mode: string; sha: string; size?: number }> }>(`${root}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated || tree.tree.length > 30_000 || order.files.length > 12) throw new PatchError("The source tree is too large to verify.", 422, "size");
  const originals = new Map<string, string>();
  const entries = order.files.map(file => {
    const entry = tree.tree.find(item => item.path === file);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) || !SHA.test(entry.sha) || (entry.size ?? Infinity) > MAX_PATCH_SOURCE_BYTES)
      throw new PatchError("A source file could not be verified.", 409, "version");
    return entry;
  });
  await Promise.all(entries.map(async entry => {
    const blob = await api<{ encoding: string; content: string }>(`${root}/git/blobs/${entry.sha}`);
    if (blob.encoding !== "base64" || blob.content.length > MAX_PATCH_SOURCE_BYTES * 1.5) throw new PatchError("Unexpected file encoding.", 422, "size");
    const bytes = Buffer.from(blob.content, "base64");
    const source = bytes.toString("utf8");
    if (bytes.length > MAX_PATCH_SOURCE_BYTES || source.includes("\uFFFD")) throw new PatchError("The file cannot be patched safely.", 422, "size");
    originals.set(entry.path, source);
  }));
  const changes = paidPatchFiles(order, originals);
  const changedTree = await api<{ sha: string }>(`${root}/git/trees`, "POST", { base_tree: commit.tree.sha,
    tree: changes.map(change => ({ path: change.file, mode: entries.find(entry => entry.path === change.file)!.mode, type: "blob", content: change.content })) });
  if (!SHA.test(changedTree.sha)) throw new PatchError("Unexpected patch tree.", 422, "verify");
  // A previous attempt may have created the branch before the PR request failed. Reuse only its exact tree and parent.
  let existing: { object: { sha: string } } | null = null;
  try { existing = await api(`${root}/git/ref/heads/${encodeURIComponent(branch)}`); }
  catch (error) { if (!(error instanceof PullRequestApiError) || error.status !== 404) throw error; }
  if (existing) {
    if (!SHA.test(existing.object.sha)) throw new PatchError("Unexpected patch branch.", 409, "version");
    const saved = await api<{ tree: { sha: string }; parents: Array<{ sha: string }> }>(`${root}/git/commits/${existing.object.sha}`);
    if (saved.tree.sha !== changedTree.sha || saved.parents.length !== 1 || saved.parents[0].sha !== order.commitSha)
      throw new PatchError("The patch branch was changed. It will not be overwritten.", 409, "version");
  } else {
    const fixed = await api<{ sha: string }>(`${root}/git/commits`, "POST", { message: text?.commitMessage ?? "fix: correct verified import casing", tree: changedTree.sha, parents: [order.commitSha] });
    if (!SHA.test(fixed.sha)) throw new PatchError("Unexpected patch commit.", 422, "verify");
    await assertBase();
    await api(`${root}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: fixed.sha });
  }
  await assertBase();
  const pr = await api<Pull>(`${root}/pulls`, "POST", {
    title: text?.title ?? "Fix verified import casing", head: branch, base: repository.default_branch, draft: text?.draft ?? true,
    body: text?.body ?? `## Verified import casing fix\n\nCorrects import paths in ${changes.length} file(s), using the patch purchased from DeployDoctor.\n\nScanned commit: ${order.commitSha}\n\nOnly import letter case is changed. The patch was checked against the original source; repository code was never executed. Review the diff and run your tests and build before merging. This does not guarantee a successful deployment.\n\nReport: https://deploydoctor.nyttolabs.com/r/${order.reportId}`,
  });
  return { ...checkedPull(pr, order.repoUrl), reused: false };
}

export class PullRequestApiError extends Error {
  constructor(public readonly status: number) { super("GitHub could not complete this request. Check token permissions or retry."); }
}
