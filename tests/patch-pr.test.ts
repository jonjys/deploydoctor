import assert from "node:assert/strict";
import test from "node:test";
import { buildCasePatch, sourceHash } from "../src/lib/patch/case-patch";
import { openPatchPullRequest, paidPatchFiles, PullRequestApiError, type GitRequest, type PrOrder } from "../src/lib/patch/pull-request";
const source = "// import X from './wrong';\nconst example = \"import X from './wrong'\";\nimport Widget from './widget';\n";
const base = "a".repeat(40), tree = "b".repeat(40), changed = "c".repeat(40), fixed = "d".repeat(40);
const patch = buildCasePatch("src/main.ts", source, [{ specifier: "./widget", exact: "./Widget" }]);
const order: PrOrder = { repoUrl: "https://github.com/acme/demo", commitSha: base, patch: patch.diff, files: ["src/main.ts"], sourceHashes: { "src/main.ts": sourceHash(source) }, reportId: "report" };
const branchKey = "f".repeat(24);
function mock(options: { moved?: boolean; permission?: boolean; privateRepo?: boolean; symlink?: boolean; changedSource?: boolean; existing?: boolean; retry?: boolean; tamperedBranch?: boolean; moveOnSecondRead?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let refs = 0;
  const api: GitRequest = async <T,>(path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    let result: unknown;
    if (path === "/repos/acme/demo") result = { full_name: "acme/demo", default_branch: "main", private: !!options.privateRepo, permissions: { push: options.permission !== false } };
    else if (path.includes("/pulls?")) result = options.existing ? [{ html_url: "https://github.com/acme/demo/pull/1", state: "closed", draft: false }] : [];
    else if (path.endsWith("/git/ref/heads/main")) { refs++; result = { object: { sha: options.moved || (options.moveOnSecondRead && refs > 1) ? fixed : base } }; }
    else if (path.includes("/git/ref/heads/deploydoctor")) { if (!options.retry) throw new PullRequestApiError(404); result = { object: { sha: fixed } }; }
    else if (path.endsWith(`/git/commits/${base}`)) result = { tree: { sha: tree } };
    else if (path.endsWith(`/git/commits/${fixed}`)) result = { tree: { sha: options.tamperedBranch ? tree : changed }, parents: [{ sha: base }] };
    else if (path.includes("/git/trees/") && method === "GET") result = { truncated: false, tree: [{ path: "src/main.ts", type: "blob", mode: options.symlink ? "120000" : "100644", sha: tree, size: source.length }] };
    else if (path.includes("/git/blobs/")) result = { encoding: "base64", content: Buffer.from(options.changedSource ? source + "// changed\n" : source).toString("base64") };
    else if (path.endsWith("/git/trees") && method === "POST") result = { sha: changed };
    else if (path.endsWith("/git/commits") && method === "POST") result = { sha: fixed };
    else if (path.endsWith("/git/refs") && method === "POST") result = { ref: "created" };
    else if (path.endsWith("/pulls") && method === "POST") result = { html_url: "https://github.com/acme/demo/pull/2", state: "open", draft: true };
    else throw new Error(`Unexpected ${method} ${path}`);
    return result as T;
  };
  return { api, calls };
}
test("paid files apply exact import edits while comments and example strings remain unchanged", () => {
  assert.deepEqual(paidPatchFiles(order, new Map([["src/main.ts", source]])), [{ file: "src/main.ts", content: patch.after }]);
  assert.ok(patch.after.includes("// import X from './wrong'"));
  for (const changed of [{ ...order, files: ["../main.ts"] }, { ...order, patch: patch.diff + patch.diff }, { ...order, sourceHashes: undefined }, { ...order, sourceHashes: { "src/main.ts": "0".repeat(64) } }]) assert.throws(() => paidPatchFiles(changed, new Map([["src/main.ts", source]])));
});
test("draft PR preserves the base tree and file modes, creates one new branch, and never merges or force-pushes", async () => {
  const { api, calls } = mock();
  const result = await openPatchPullRequest(order, branchKey, api);
  assert.equal(result.url, "https://github.com/acme/demo/pull/2");
  const treeWrite = calls.find(call => call.path.endsWith("/git/trees") && call.method === "POST")!;
  assert.deepEqual(treeWrite.body, { base_tree: tree, tree: [{ path: "src/main.ts", mode: "100644", type: "blob", content: patch.after }] });
  const pr = calls.find(call => call.path.endsWith("/pulls") && call.method === "POST")!.body as Record<string, unknown>;
  assert.equal(pr.draft, true); assert.equal(pr.base, "main");
  assert.ok(calls.every(call => ["GET", "POST"].includes(call.method) && !call.path.includes("/merges")));
});
test("changed commits, changed blobs, symlinks and missing repository permission are refused before writes", async () => {
  for (const options of [{ moved: true }, { changedSource: true }, { symlink: true }, { permission: false }, { privateRepo: true }]) {
    const { api, calls } = mock(options);
    await assert.rejects(() => openPatchPullRequest(order, branchKey, api));
    assert.equal(calls.filter(call => call.method === "POST").length, 0);
  }
});
test("a branch advancing while preparing the patch cannot receive a PR", async () => {
  const { api, calls } = mock({ moveOnSecondRead: true });
  await assert.rejects(() => openPatchPullRequest(order, branchKey, api));
  assert.ok(!calls.some(call => call.path.endsWith("/git/refs") && call.method === "POST"));
  assert.ok(!calls.some(call => call.path.endsWith("/pulls") && call.method === "POST"));
});
test("retries return an existing PR even when closed, and reuse only an unmodified matching branch", async () => {
  const exists = mock({ existing: true });
  assert.equal((await openPatchPullRequest(order, branchKey, exists.api)).state, "closed");
  assert.ok(exists.calls.every(call => call.method === "GET"));
  const retry = mock({ retry: true });
  await openPatchPullRequest(order, branchKey, retry.api);
  assert.ok(!retry.calls.some(call => call.path.endsWith("/git/refs") && call.method === "POST"));
  const tampered = mock({ retry: true, tamperedBranch: true });
  await assert.rejects(() => openPatchPullRequest(order, branchKey, tampered.api));
  assert.ok(!tampered.calls.some(call => call.path.endsWith("/pulls") && call.method === "POST"));
});
