import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreCard } from "../src/components/report-ignore";
import { LangProvider } from "../src/components/lang";
import { analysisText } from "../src/lib/analysis-text";
import { findingSummary, reportLabel } from "../src/lib/report-summary";
import { freeFixInstructions } from "../src/lib/fix-instructions";
import { isPartialPlaceholder, showsLocalWhy } from "../src/lib/report-insights";
import { badgeStatus, BADGE_COLORS } from "../src/lib/report-badge";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import type { CheckResult, StoredReport } from "../src/types/report";
const x = analysisText("en");
const coverage: CheckResult = { id: "imports", title: "Imports", status: "yellow", explanation: "Incomplete", fix: x.partialFixRetry, evidence: [], findings: [] };
const env: CheckResult = { id: "env", title: "Env documentation", status: "yellow", explanation: "Document one variable", fix: "Check the template", evidence: [], findings: [{ file: "src/a.ts", line: 1, problem: "Missing template entry", fix: "Document it" }] };
function report(checks: CheckResult[]): StoredReport { return { id: "r", repo_url: "https://github.com/acme/app", created_at: "2026-10-24", results: { repository: { owner: "acme", name: "app", defaultBranch: "main" }, checkedAt: "2026-10-24", summary: { red: 0, yellow: checks.length, green: 0 }, overall: "yellow", checks, nextApp: "root", scan: { partial: true, filesInTree: 197, sourceFilesFound: 197, sourceFilesRead: 165 } } }; }
test("coverage is separate from findings for legacy reports, headline, badge and copied fixes", () => {
  const r = report([coverage, env]);
  assert.equal(isPartialPlaceholder(coverage), true);
  assert.deepEqual(findingSummary(r.results.checks), { red: 0, yellow: 1, green: 0 });
  assert.equal(reportLabel(r.results), "1 item to review");
  assert.equal(badgeStatus(r.results).label, "1 item to review");
  const copy = freeFixInstructions(r);
  assert.match(copy, /Document one variable/); assert.doesNotMatch(copy, /Scan again|GITHUB_TOKEN/);
  assert.equal(showsLocalWhy(env, "root"), false);
});
test("an incomplete scan with no code findings never gets a ready headline or green badge", () => {
  const r = report([coverage]);
  assert.equal(reportLabel(r.results), "No findings in checked files");
  assert.equal(badgeStatus(r.results).color, BADGE_COLORS.neutral);
  assert.doesNotMatch(freeFixInstructions(r), /all checks passed|ready to deploy/i);
  const html = renderToStaticMarkup(createElement(LangProvider, { lang: "en" } as ComponentProps<typeof LangProvider>, createElement(ScoreCard, { checks: [{ id: "imports", status: "yellow", coverageOnly: true }], partial: true })));
  assert.match(html, /No findings in checked files/); assert.match(html, /1 checks could not be fully verified/); assert.doesNotMatch(html, /items? to review/);
});
test("terminal preferences are not required Vercel configuration; real app variables remain findings", () => {
  const sources = { "package.json": JSON.stringify({ dependencies: { next: "16.4.2" } }), "app/page.tsx": 'export default function Page(){ return <p>{process.env.REAL_API_KEY}</p> }', "cli/bin.mjs": 'if (process.env.NO_COLOR || process.env.FORCE_COLOR) console.log("plain");' };
  const snapshot: RepositorySnapshot = { owner: "acme", name: "app", defaultBranch: "main", entries: Object.keys(sources).map(path => ({ path, type: "blob" })), contents: new Map(Object.entries(sources)), sourceFilesFound: 2, sourceFilesRead: 2, partial: false };
  const result = analyzeSnapshot(snapshot).checks.find(c => c.id === "env")!;
  assert.match(result.explanation, /REAL_API_KEY/); assert.doesNotMatch(JSON.stringify(result), /NO_COLOR|FORCE_COLOR/);
});
