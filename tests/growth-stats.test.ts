import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FindingStats } from "../src/components/finding-stats";
import { scansInWindow, type ScanInsights } from "../src/lib/scan-insights";

const data: ScanInsights = {
  generatedAt: "2026-10-27T12:00:00Z", windowDays: 30, scanLimit: 5000, scans: 8, repositories: 4,
  categories: [{ id: "production-safety", red: 0, yellow: 1, checked: 2 }, { id: "env", red: 2, yellow: 1, checked: 4 }],
  days: [{ day: "2026-10-01", count: 5 }, { day: "2026-10-21", count: 2 }, { day: "2026-10-27", count: 1 }], activity: [],
};

test("Growth scan volume respects UTC reporting windows without pretending to deduplicate daily counts", () => {
  assert.equal(scansInWindow(data, "2026-10-21T00:00:00Z", "2026-10-27T12:00:00Z"), 3);
  assert.equal(scansInWindow(data, "2026-09-28T00:00:00Z", "2026-10-27T12:00:00Z"), 8);
  assert.equal(scansInWindow(data, "2026-10-22T00:00:00Z", "2026-10-26T12:00:00Z"), 0);
  assert.equal(scansInWindow({ ...data, scans: 5000 }, "2026-10-21T00:00:00Z", "2026-10-27T12:00:00Z"), null);
  assert.equal(scansInWindow(data, "2026-09-01T00:00:00Z", "2026-10-27T12:00:00Z"), null);
});

test("shared findings rank real counts, retain review severity and use each check's denominator", () => {
  const html = renderToStaticMarkup(createElement(FindingStats, { data }));
  assert.ok(html.indexOf("Environment variables") < html.indexOf("Payment and production safety"));
  assert.match(html, /3 \/ 4 checked repos/);
  assert.match(html, /75%/);
  assert.match(html, /1 to review/);
  assert.match(html, /50%/);
  assert.doesNotMatch(html, /<table|failed deployments|0 findings/);
  assert.match(renderToStaticMarkup(createElement(FindingStats, { data: { ...data, categories: [] } })), /No complete public scan data yet/);
});
