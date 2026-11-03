import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { comparePullRequest } from "../src/lib/pr-impact";
import { pullRequestFromInput, repoUrlFromParam } from "../src/lib/repo-input";
import { reportJson } from "../src/lib/report-json";
import type { CheckResult, Finding, ReportResults } from "../src/types/report";

const baseSha = "a".repeat(40), headSha = "b".repeat(40);
const meta = { number: 42, url: "https://github.com/fixture/shop/pull/42", baseRef: "main", baseCommitSha: baseSha, headCommitSha: headSha };
const finding = (problem: string, line = 1, file = "app/page.tsx"): Finding => ({ file, line, problem, fix: "Use the correct import path.", ruleId: "import-case", status: "red" });
const check = (findings: Finding[], extra: Partial<CheckResult> = {}): CheckResult => ({ id: "imports", title: "Broken imports", status: findings.length ? "red" : "green", findings, evidence: [], explanation: "fixture", fix: "fixture", ...extra });
const report = (sha: string, checks: CheckResult[], partial = false): ReportResults => ({ repository: { owner: "fixture", name: "shop", defaultBranch: "main", commitSha: sha }, checkedAt: "2026-11-03T08:00:00Z", checks, summary: { red: 0, yellow: 0, green: 0 }, overall: "green", scan: { partial, filesInTree: 3, sourceFilesRead: 2, sourceFilesFound: 2 } });

test("PR links retain the PR number and normalize detection to its repository", () => {
  for (const value of ["https://github.com/fixture/shop/pull/42", "github.com/fixture/shop/pull/42/files#diff-abc", " https://www.github.com/fixture/shop/pull/42/commits "]) {
    assert.deepEqual(pullRequestFromInput(value), { repoUrl: "https://github.com/fixture/shop", number: 42, url: meta.url });
    assert.equal(repoUrlFromParam(value), "https://github.com/fixture/shop");
  }
  for (const value of ["https://evil.test/fixture/shop/pull/42", "https://token@github.com/fixture/shop/pull/42", "https://github.com/fixture/shop/pull/42?token=x", "https://github.com/fixture/shop/pull/0", "https://github.com/fixture/shop/pull/42/files/extra", "https://github.com/fixture/shop/pull/1e2", "https://github.com/fixture/shop/pull/99999999999", "http://github.com/fixture/shop/pull/42"]) assert.equal(pullRequestFromInput(value), null, value);
});
test("line movement, duplicate occurrences and changed check severity do not fabricate a new finding", () => {
  const old = report(baseSha, [check([finding("old", 3), finding("old", 9), finding("removed")])]);
  const head = report(headSha, [check([finding("old", 19), finding("old", 23), finding("new", 30)])]);
  const result = comparePullRequest(old, head, meta);
  assert.deepEqual(result.introduced.map(f => f.problem), ["new"]);
  assert.equal(result.persisting.length, 2);
  assert.deepEqual(result.noLongerDetected.map(f => f.problem), ["removed"]);
  assert.equal(comparePullRequest(report(baseSha, [check([finding("old")])]), report(headSha, [check([{ ...finding("old"), status: "yellow" }], { status: "yellow" })]), meta).introduced.length, 0);
  const extra = comparePullRequest(report(baseSha, [check([finding("old")])]), report(headSha, [check([finding("old", 5), finding("old", 20)])]), meta);
  assert.equal(extra.introduced.length, 1); assert.equal(extra.persisting.length, 1);
});
test("GitHub rename evidence keeps an unchanged finding in the existing bucket", () => {
  const result = comparePullRequest(report(baseSha, [check([finding("old", 1, "old.ts")])]), report(headSha, [check([finding("old", 10, "new.ts")])]), meta, { "old.ts": "new.ts" });
  assert.equal(result.persisting.length, 1); assert.equal(result.introduced.length, 0); assert.equal(result.noLongerDetected.length, 0);
});
test("partial scans and truncated rename inventories never label unmatched findings new or fixed", () => {
  for (const [partialBase, partialHead, complete] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const result = comparePullRequest(report(baseSha, [check([finding("old"), finding("same")])], partialBase), report(headSha, [check([finding("new"), finding("same", 5)])], partialHead), meta, {}, complete);
    assert.equal(result.partial, true); assert.equal(result.introduced.length, 0); assert.equal(result.noLongerDetected.length, 0);
    assert.equal(result.persisting.length, 1); assert.deepEqual(result.uncertain.map(f => f.side).sort(), ["base", "head"]);
  }
});
test("different languages, rule coverage, missing checks and coverage placeholders require review", () => {
  for (const changed of [check([finding("new")], { title: "Andra importer" }), check([finding("new")], { evaluatedRules: ["new-rule"] }), check([], { status: "yellow", coverageOnly: true })]) {
    const result = comparePullRequest(report(baseSha, [check([finding("old")])]), report(headSha, [changed]), meta);
    assert.equal(result.introduced.length, 0); assert.equal(result.noLongerDetected.length, 0); assert.ok(result.notCompared.includes("imports"));
  }
  assert.equal(comparePullRequest(report(baseSha, []), report(headSha, [check([finding("new")])]), meta).uncertain.length, 1);
  assert.equal(comparePullRequest(report(baseSha, [check([finding("old")])]), report(headSha, []), meta).uncertain.length, 1);
});
test("wrong repository and unpinned or mismatched snapshots cannot be compared", () => {
  const a = report(baseSha, []), b = report(headSha, []);
  for (const bad of [{ ...b, repository: { ...b.repository, name: "other" } }, { ...b, repository: { ...b.repository, commitSha: undefined } }]) assert.throws(() => comparePullRequest(a, bad, meta));
  assert.throws(() => comparePullRequest(a, b, { ...meta, baseCommitSha: "main" }));
});
test("real Next.js snapshots distinguish a new casing break from an existing env risk and ignore commented imports", () => {
  const files = { "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "16.4.2", react: "19.2.8" } }), "app/page.tsx": 'import Button from "./Button"; const endpoint = process.env.ORDERS_API; export default function Page(){return <Button/>}', "app/Button.tsx": "export default function Button(){return null}", ".env.example": "" };
  const analyze = (files: Record<string, string>, sha: string) => {
    const snapshot: RepositorySnapshot = { owner: "fixture", name: "shop", defaultBranch: "main", entries: Object.keys(files).map(path => ({ path, type: "blob" })), contents: new Map(Object.entries(files)), partial: false, sourceFilesRead: 2, sourceFilesFound: 2 };
    return { ...analyzeSnapshot(snapshot), repository: { owner: "fixture", name: "shop", defaultBranch: "main", commitSha: sha } };
  };
  const base = analyze(files, baseSha);
  const head = analyze({ ...files, "app/page.tsx": '// import Ghost from "./missing";\n' + files["app/page.tsx"].replace('"./Button"', '"./button"') }, headSha);
  const diff = comparePullRequest(base, head, meta);
  assert.equal(diff.introduced.filter(f => f.checkId === "imports").length, 1);
  assert.ok(diff.persisting.some(f => f.checkId === "env" && f.problem.includes("ORDERS_API")));
  assert.ok(!diff.introduced.some(f => /Ghost|missing/.test(f.problem)));
  const fixed = comparePullRequest({ ...head, repository: { ...head.repository, commitSha: baseSha } }, { ...base, repository: { ...base.repository, commitSha: headSha } }, meta);
  assert.equal(fixed.noLongerDetected.filter(f => f.checkId === "imports").length, 1);
});
test("report JSON preserves legacy fields and includes an optional comparison without a second report or source payload", () => {
  const results = report(headSha, [check([])]), stored = { id: "fixture", repo_url: "https://github.com/fixture/shop", created_at: results.checkedAt, results };
  const legacy = reportJson(stored), impact = comparePullRequest(report(baseSha, [check([])]), results, meta);
  const current = reportJson({ ...stored, results: { ...results, pullRequest: impact } });
  assert.equal(legacy.pullRequest, null);
  assert.deepEqual({ ...current, pullRequest: null }, legacy);
  assert.equal(current.commitSha, headSha); assert.equal(current.pullRequest?.baseCommitSha, baseSha);
  assert.match(current.pullRequest!.limitations.join(" "), /not a build/);
});

test("GitHub PR orchestration resolves a merge base, pins both scans and rejects stale heads and forks before downloads", async () => {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = { exports: {}, loaded: true } as NodeModule;
  const { analyzeGitHubPullRequest } = await import("../src/lib/github-pull-request");
  const requests: string[] = [], scans: Array<{ url: string; ref?: string; privateToken?: string }> = [];
  let fork = false, privateRepo = false, changedFiles = 0;
  const backend = {
    request: async <T,>(path: string, token?: string) => {
      requests.push(path); assert.equal(token, "fixture-read-token");
      return (path.includes("/pulls/") ? { number: 42, base: { ref: "main", sha: "c".repeat(40), repo: { full_name: "fixture/shop", private: privateRepo } }, head: { sha: headSha, repo: { full_name: fork ? "elsewhere/shop" : "fixture/shop" } } }
        : { merge_base_commit: { sha: baseSha }, files: Array.from({ length: changedFiles }, () => ({ status: "modified", filename: "x" })) }) as T;
    },
    scan: async (url: string, options: { ref?: string; privateToken?: string } = {}) => { scans.push({ url, ...options }); return { canonicalUrl: url, isPrivate: privateRepo, results: report(options.ref!, [check(options.ref === headSha ? [finding("new")] : [])]) }; },
  };
  const run = () => analyzeGitHubPullRequest("https://github.com/fixture/shop", 42, { privateToken: "fixture-read-token", expectedHeadSha: headSha }, backend);
  const result = await run();
  assert.equal(result.results.pullRequest.baseCommitSha, baseSha); assert.equal(result.results.pullRequest.introduced.length, 1);
  assert.deepEqual(scans.map(s => s.ref).sort(), [baseSha, headSha]); assert.ok(scans.every(s => s.privateToken === "fixture-read-token"));
  assert.ok(requests.some(s => s.includes(`${"c".repeat(40)}...${headSha}?per_page=1`)));
  scans.length = 0; fork = true; await assert.rejects(run, /Fork pull requests/); assert.equal(scans.length, 0); fork = false;
  await assert.rejects(() => analyzeGitHubPullRequest("https://github.com/fixture/shop", 42, { privateToken: "fixture-read-token", expectedHeadSha: baseSha }, backend), /head changed/); assert.equal(scans.length, 0);
  privateRepo = true; assert.equal((await run()).isPrivate, true);
  changedFiles = 300; assert.equal((await run()).results.pullRequest.introduced.length, 0);
});

test("public PR metadata can recover from a contents-only service token, but never bypass buyer access or rate limits",async()=>{
  const require=createRequire(import.meta.url);require.cache[require.resolve("server-only")]={exports:{},loaded:true} as NodeModule;
  const {analyzeGitHubPullRequest}=await import("../src/lib/github-pull-request");const {GitHubApiError}=await import("../src/lib/github");
  const previous=process.env.GITHUB_TOKEN;process.env.GITHUB_TOKEN="fixture-service-token";
  const calls:Array<{path:string;token?:string}>=[];let status=404,privateRepo=false,scans=0;
  const backend={request:async<T,>(path:string,token?:string)=>{calls.push({path,token});
    if(path.endsWith("/pulls/42")){if(token)throw new GitHubApiError("Fixture",status,status===429?"gh.rateLimit":"gh.notFound");return {number:42,base:{ref:"main",sha:baseSha,repo:{full_name:"fixture/shop",private:false}},head:{sha:headSha,repo:{full_name:"fixture/shop"}}} as T;}
    if(path==="/repos/fixture/shop")return {private:privateRepo} as T;
    return {merge_base_commit:{sha:baseSha},files:[]} as T;},
    scan:async(url:string,options:{ref?:string}={})=>{scans++;return{canonicalUrl:url,isPrivate:false,results:report(options.ref!,[check([])])};}};
  try{
    await analyzeGitHubPullRequest("https://github.com/fixture/shop",42,{},backend);assert.equal(scans,2);assert.equal(calls.filter(c=>c.path.endsWith('/pulls/42')&&!c.token).length,1);
    calls.length=0;scans=0;await assert.rejects(()=>analyzeGitHubPullRequest("https://github.com/fixture/shop",42,{privateToken:"buyer-token"},backend));assert.equal(calls.length,1);assert.equal(scans,0);
    calls.length=0;privateRepo=true;await assert.rejects(()=>analyzeGitHubPullRequest("https://github.com/fixture/shop",42,{},backend));assert.equal(calls.length,2);assert.ok(calls.every(c=>c.token));
    privateRepo=false;for(const code of [403,429]){status=code;calls.length=0;await assert.rejects(()=>analyzeGitHubPullRequest("https://github.com/fixture/shop",42,{},backend));assert.equal(calls.length,1);}
    delete process.env.GITHUB_TOKEN;status=404;calls.length=0;
    const anonymous={...backend,request:async<T,>()=>{throw new GitHubApiError("Fixture",404,"gh.notFound");return {} as T;}};
    await assert.rejects(()=>analyzeGitHubPullRequest("https://github.com/fixture/shop",42,{},anonymous),(error:unknown)=>error instanceof GitHubApiError&&error.key===undefined&&/pull request/.test(error.message));
  }finally{if(previous===undefined)delete process.env.GITHUB_TOKEN;else process.env.GITHUB_TOKEN=previous;}
});
