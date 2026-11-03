import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { contextualFindings, comparePullRequest, type ContextualFinding } from "../src/lib/pr-impact";
import { reportJson } from "../src/lib/report-json";
import type { CheckResult, Finding, ReportResults } from "../src/types/report";

const baseSha = "a".repeat(40), headSha = "b".repeat(40);
const finding = (problem: string, line = 1): Finding => ({ file: "app/page.tsx", line, problem, fix: "Verify this source change.", status: "yellow", ruleId: "fixture-rule" });
const check = (findings: Finding[], extra: Partial<CheckResult> = {}): CheckResult => ({ id: "imports", title: "Imports", status: findings.length ? "yellow" : "green", findings, explanation: "Source observations", evidence: [], fix: "Review the source.", ...extra });
const report = (sha: string, checks: CheckResult[], partial = false): ReportResults => ({ repository: { owner: "fixture", name: "shop", defaultBranch: "main", commitSha: sha }, checkedAt: "2026-11-03T09:00:00Z", checks, overall: "yellow", summary: { red: 0, yellow: 1, green: 0 }, scan: { partial, sourceFilesRead: 1, sourceFilesFound: 1, filesInTree: 1 } });
const compare = (before: Finding[], after: Finding[], partial = false) => {
  const base = report(baseSha, [check(before)]), head = report(headSha, [check(after)], partial);
  return { ...head, pullRequest: comparePullRequest(base, head, { number: 1, url: "https://github.com/fixture/shop/pull/1", baseRef: "main", baseCommitSha: baseSha, headCommitSha: headSha }) };
};

test("each current finding retains its evidence and gets exact comparison context without mutation", () => {
  const results = compare([finding("existing", 2), finding("removed", 3)], [finding("existing", 8), finding("new", 20)]);
  const original = JSON.stringify(results);
  const current = contextualFindings(results).get("imports")!;
  assert.deepEqual(current.map(f => [f.problem, f.line, f.prOrigin]), [["existing", 8, "existing"], ["new", 20, "introduced"]]);
  assert.equal(current.some(f => f.problem === "removed"), false);
  assert.equal(JSON.stringify(results), original);
  assert.equal(current[0].status, "yellow");
});
test("context counts duplicate occurrences independently and separates identical findings in different checks", () => {
  const results = compare([finding("same")], [finding("same"), finding("same")]);
  assert.deepEqual(contextualFindings(results).get("imports")!.map(f => f.prOrigin), ["existing", "introduced"]);
  results.checks.push(check([finding("same")], { id: "env", title: "Environment" }));
  assert.equal(contextualFindings(results).get("env")![0].prOrigin, "uncertain");
});
test("partial, uncovered, stale or unmatched observations never get a definite new/existing label", () => {
  const partial = compare([finding("same")], [finding("same"), finding("new")], true);
  assert.deepEqual(contextualFindings(partial).get("imports")!.map(f => f.prOrigin), ["existing", "uncertain"]);
  for (const change of ["head", "base", "coverage", "unmatched"] as const) {
    const r = compare([finding("old")], [finding("new")]);
    if (change === "head") r.pullRequest.headCommitSha = "c".repeat(40);
    if (change === "base") r.pullRequest.baseCommitSha = "main";
    if (change === "coverage") r.pullRequest.notCompared.push("imports");
    if (change === "unmatched") r.pullRequest.introduced[0].line = 99;
    assert.equal(contextualFindings(r).get("imports")![0].prOrigin, "uncertain", change);
  }
});
test("ordinary reports remain untouched and API origin annotations leave the check outcome intact", () => {
  const results = compare([finding("old")], [finding("new")]);
  const stored = { id: "fixture", repo_url: "https://github.com/fixture/shop", created_at: results.checkedAt, results };
  const json = reportJson(stored);
  assert.equal((json.checks[0].findings[0] as ContextualFinding).prOrigin, "introduced");
  assert.equal(json.overall, results.overall); assert.deepEqual(json.summary, results.summary);
  const ordinary = { ...results, pullRequest: undefined };
  assert.equal(contextualFindings(ordinary).size, 0);
  assert.deepEqual(reportJson({ ...stored, results: ordinary }).checks[0].findings, ordinary.checks[0].findings);
});

test("rendered context shows new and uncertain findings directly, keeps old ones in a closed disclosure, escapes source text", () => {
  const require = createRequire(import.meta.url), previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  let PrFindingList: typeof import("../src/components/pr-finding-list").PrFindingList;
  try { ({ PrFindingList } = require("../src/components/pr-finding-list")); }
  finally { if (previous) require.extensions[".css"] = previous; else delete require.extensions[".css"]; }
  const findings: ContextualFinding[] = [{ ...finding("NEW <script> @someone"), prOrigin: "introduced" }, { ...finding("UNKNOWN"), prOrigin: "uncertain" }, { ...finding("OLD"), prOrigin: "existing" }];
  const html = renderToStaticMarkup(createElement(PrFindingList, { findings, lang: "en" }));
  assert.match(html, /Newly detected in this PR/); assert.match(html, /Origin needs review/); assert.match(html, /Already present at the base/);
  assert.match(html, /<details[^>]*><summary>Show already-present findings/); assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.ok(html.indexOf("UNKNOWN") < html.indexOf("<details")); assert.ok(html.indexOf(">OLD<") > html.indexOf("<details"));
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/); assert.match(html, /full check status still includes existing problems/);
  const sv = renderToStaticMarkup(createElement(PrFindingList, { findings, lang: "sv" })); assert.match(sv, /Fanns redan i basen/);
});
