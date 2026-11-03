import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ReportResults, StoredReport } from "../src/types/report";

test("real report handler shares existing quota/authentication for PR scans and never saves stale or unauthorized results", async () => {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = { exports: {}, loaded: true } as NodeModule;
  let paid = false, viaToken = false, invalidToken = false, connected = false, privateResult = false, stale = false, oidcRepo = "fixture/shop";
  const customer = { customerId: "cus_owner", email: "owner@example.test" };
  const reservations: unknown[] = [], finished: unknown[] = [], saved: unknown[] = [], scans: unknown[] = [], compares: unknown[] = [];
  const result: ReportResults = { repository: { owner: "fixture", name: "shop", defaultBranch: "main", commitSha: "b".repeat(40) }, checkedAt: new Date().toISOString(), checks: [], summary: { red: 0, yellow: 0, green: 0 }, overall: "green", scan: { filesInTree: 1, sourceFilesRead: 1, sourceFilesFound: 1, partial: false } };
  require.cache[require.resolve("../src/lib/access")] = { loaded: true, exports: {
    requestCustomer: async () => ({ customer: paid ? customer : null, viaToken, invalidToken }), activePlan: async () => paid ? { plan: "day" } : null,
    bearerToken: (request: Request) => request.headers.get("authorization"), reserveScan: async (_req: Request, allowance: unknown) => { reservations.push(allowance); return { allowed: true, id: "reservation" }; },
    finishScan: async (id: string, success: boolean) => { finished.push({ id, success }); },
  } } as NodeModule;
  require.cache[require.resolve("../src/lib/github-connect")] = { loaded: true, exports: { githubConnection: async () => connected ? { token: "fixture-private-credential" } : null } } as NodeModule;
  require.cache[require.resolve("../src/lib/stripe")] = { loaded: true, exports: { sameOrigin: (request: Request) => request.headers.get("origin") === "https://fixture.test" } } as NodeModule;
  require.cache[require.resolve("../src/lib/github-oidc")] = { loaded: true, exports: { OIDC_HEADER: "x-github-oidc-token", verifyGitHubOidc: async () => ({ repository: oidcRepo, repository_visibility: "public" }) } } as NodeModule;
  const github = require("../src/lib/github");
  require.cache[require.resolve("../src/lib/github")]!.exports = { ...github, analyzeGitHubRepository: async (...args: unknown[]) => { scans.push(args); return { canonicalUrl: "https://github.com/fixture/shop", results: result, isPrivate: privateResult }; } };
  require.cache[require.resolve("../src/lib/github-pull-request")] = { loaded: true, exports: { analyzeGitHubPullRequest: async (...args: unknown[]) => {
    compares.push(args); if (stale) throw new github.GitHubApiError("The PR head changed.", 409);
    return { canonicalUrl: "https://github.com/fixture/shop", isPrivate: privateResult, results: { ...result, pullRequest: { version: 1, number: 42, url: "https://github.com/fixture/shop/pull/42", baseRef: "main", baseCommitSha: "a".repeat(40), headCommitSha: "b".repeat(40), partial: false, introduced: [], persisting: [], noLongerDetected: [], uncertain: [], notCompared: [], limitations: [] } } };
  } } } as NodeModule;
  require.cache[require.resolve("../src/lib/reports")] = { loaded: true, exports: { saveReport: async (url: string, results: ReportResults, owner?: string, isPrivate = false): Promise<StoredReport> => { saved.push({ url, owner, isPrivate }); return { id: "12345678-1234-4234-8234-123456789abc", repo_url: url, results, is_private: isPrivate, created_at: result.checkedAt }; } } } as NodeModule;
  const { POST } = await import("../src/app/api/reports/route");
  const send = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("https://fixture.test/api/reports", { method: "POST", headers: { origin: "https://fixture.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const target = { repoUrl: "https://github.com/fixture/shop/pull/42" };
  assert.equal((await send(target, { origin: "https://evil.test" })).status, 403);
  for (const pullRequest of [0, -1, "42", 42.5, 43, 1e15]) assert.equal((await send({ ...target, pullRequest })).status, 400);
  assert.equal((await send({ ...target, ref: "main" })).status, 400);
  assert.equal(reservations.length, 0); assert.equal(compares.length, 0);
  const free = await send(target); assert.equal(free.status, 201); assert.equal(compares.length, 1); assert.equal(scans.length, 0); assert.deepEqual(reservations, [{ limit: 1 }]); assert.deepEqual(finished, [{ id: "reservation", success: true }]);
  assert.equal((await send({ ...target, privateToken: "fixture-private-credential" })).status, 402); assert.equal(compares.length, 1);
  paid = true; connected = true; privateResult = true;
  assert.equal((await send(target)).status, 201);
  assert.equal((compares.at(-1) as [string, number, { privateToken: string }])[2].privateToken, "fixture-private-credential");
  assert.deepEqual(saved.at(-1), { url: "https://github.com/fixture/shop", owner: "cus_owner", isPrivate: true });
  assert.equal(reservations.length, 1);
  connected = false; viaToken = true;
  const api = await send({ ...target, ref: "b".repeat(40), privateToken: "fixture-private-credential" }, { authorization: "Bearer fixture" });
  const apiBody = await api.json(); assert.equal(api.status, 201); assert.equal(apiBody.pullRequest.headCommitSha, "b".repeat(40)); assert.equal(apiBody.isPrivate, true); assert.doesNotMatch(JSON.stringify(apiBody), /fixture-private-credential/);
  paid = false; assert.equal((await send(target, { authorization: "Bearer fixture" })).status, 402);
  invalidToken = true; assert.equal((await send(target)).status, 401); invalidToken = false; viaToken = false;
  oidcRepo = "elsewhere/repo"; assert.equal((await send(target, { "x-github-oidc-token": "fixture" })).status, 403);
  stale = true; privateResult = false; const savesBefore = saved.length;
  assert.equal((await send(target)).status, 409); assert.equal(saved.length, savesBefore); assert.deepEqual(finished.at(-1), { id: "reservation", success: false });
  stale = false; assert.equal((await send({ repoUrl: "https://github.com/fixture/shop" })).status, 201); assert.equal(scans.length, 1);
});
