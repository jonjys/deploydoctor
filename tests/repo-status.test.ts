import assert from "node:assert/strict";
import test from "node:test";
import { statusRepository, statusFilter, repoStatus, liveBadgeMarkdown, STATUS_MAX_AGE_MS } from "../src/lib/repo-status";
import { BADGE_COLORS } from "../src/lib/report-badge";
import type { StoredReport } from "../src/types/report";
const now = Date.parse("2026-10-24T12:00:00Z");
function report(): StoredReport {
  return { id: "r", repo_url: "https://github.com/acme/demo", created_at: "2026-10-24T11:00:00Z", results: {
    repository: { owner: "acme", name: "demo", defaultBranch: "main", commitSha: "a".repeat(40) }, checkedAt: "2026-10-24T11:00:00Z",
    nextApp: "root", overall: "green", summary: { red: 0, yellow: 0, green: 1 },
    scan: { partial: false, filesInTree: 1, sourceFilesRead: 1, sourceFilesFound: 1 },
    checks: [{ id: "imports", title: "Imports", status: "green", explanation: "", fix: "", evidence: [] }],
  } };
}
test("status lookup validates path segments and escapes wildcard repo names", () => {
  assert.equal(statusFilter("ACME", "my_app")?.repo_url, "ilike.https://github.com/ACME/my\\_app");
  assert.equal(statusFilter("acme", "demo")?.["results->repository->>ref"], "is.null");
  assert.equal(statusFilter("acme", "demo")?.limit, "1");
  for (const [owner, name] of [["a/b", "demo"], ["a", ".."], ["a", "a%"], ["a", "a*b"], ["a", "a?b"], ["a", "x,or=(id.gt.0)"], ["<svg>", "demo"]]) assert.equal(statusRepository(owner, name), null);
  assert.ok(statusRepository("stats", "my_app"));
});
test("latest badge shows date and commit, and counts check results rather than an outdated summary", () => {
  const r = report();
  assert.deepEqual(repoStatus(r, now), { label: "checks passed", color: BADGE_COLORS.green, date: "2026-10-24", commit: "aaaaaaa", stale: false });
  r.results.checks[0].status = "red";
  assert.equal(repoStatus(r, now).label, "1 issue");
  assert.equal(repoStatus(r, now).color, BADGE_COLORS.red);
});
test("private, partial, stale, undated, unpinned, unsupported and empty scans never give green badges", () => {
  const variants = [
    (r: StoredReport) => { r.is_private = true; },
    (r: StoredReport) => { r.results.scan.partial = true; },
    (r: StoredReport) => { r.created_at = new Date(now - STATUS_MAX_AGE_MS - 1).toISOString(); },
    (r: StoredReport) => { r.created_at = "invalid"; },
    (r: StoredReport) => { r.created_at = new Date(now + 86400000).toISOString(); },
    (r: StoredReport) => { delete r.results.repository.commitSha; },
    (r: StoredReport) => { r.results.nextApp = "none"; },
    (r: StoredReport) => { r.results.checks = []; },
    (r: StoredReport) => { r.results.scope = { scanned: ["vercel"], ignored: ["env"] }; },
  ];
  for (const change of variants) { const r = report(); change(r); assert.equal(repoStatus(r, now).color, BADGE_COLORS.neutral); }
  assert.equal(repoStatus(null, now).label, "not scanned");
});
test("the stable badge and score link are distinct from a single immutable report", () => {
  assert.equal(liveBadgeMarkdown("acme", "demo", "https://example.test"), "[![DeployDoctor repo status](https://example.test/badge/acme/demo.svg)](https://example.test/score/acme/demo)");
});
