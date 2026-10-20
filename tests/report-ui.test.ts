import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Breakable } from "../src/components/breakable-path";
import { GuideText } from "../src/components/guide-text";
import { guides } from "../src/lib/guides";
import { BADGE_COLORS, badgeStatus } from "../src/lib/report-badge";
import { neutralReport, overallLabel } from "../src/lib/report-summary";
import type { CheckStatus, ReportResults } from "../src/types/report";

function results(summary: Partial<Record<CheckStatus, number>>, extra: Partial<ReportResults> = {}): ReportResults {
  return {
    repository: { owner: "acme", name: "shop", defaultBranch: "main" },
    checkedAt: "2026-10-17T10:00:00.000Z",
    scan: { filesInTree: 10, sourceFilesRead: 5, sourceFilesFound: 5, partial: false },
    summary: { red: 0, yellow: 0, green: 0, ...summary },
    overall: summary.red ? "red" : summary.yellow ? "yellow" : "green",
    checks: [],
    ...extra,
  };
}

test("a report is neutral without a Next.js app at the root or another framework the scan knows", () => {
  assert.equal(neutralReport(results({}, { nextApp: "none" })), true);
  assert.equal(neutralReport(results({}, { nextApp: "nested" })), true);
  assert.equal(neutralReport(results({}, { nextApp: "none", stack: { hasPackageJson: true, hasNext: false, hasSupabase: false, hasPrisma: false, hasDrizzle: false, hasTailwind: false, framework: "sveltekit" } })), false);
  assert.equal(neutralReport(results({}, { nextApp: "root" })), false);
  // Older reports have no nextApp and keep their normal headline.
  assert.equal(neutralReport(results({})), false);
});

test("the README badge says what the report headline says", () => {
  const notNext = results({ green: 3 }, { nextApp: "none" });
  assert.deepEqual(badgeStatus(notNext), { label: "Not a Next.js app", color: BADGE_COLORS.neutral });
  assert.equal(badgeStatus(notNext).label, overallLabel(notNext.summary, "en", { notNext: neutralReport(notNext) }));
  const nested = results({ red: 2 }, { nextApp: "nested" });
  assert.deepEqual(badgeStatus(nested), { label: "Not a Next.js app", color: BADGE_COLORS.neutral });
  // Another framework at the root gets real results, so it keeps the normal headline and color.
  const svelte = results({ red: 2 }, { nextApp: "none", stack: { hasPackageJson: true, hasNext: false, hasSupabase: false, hasPrisma: false, hasDrizzle: false, hasTailwind: false, framework: "sveltekit" } });
  assert.deepEqual(badgeStatus(svelte), { label: "2 issues to fix", color: BADGE_COLORS.red });
  assert.deepEqual(badgeStatus(results({ yellow: 1 }, { nextApp: "root" })), { label: "1 item to review", color: BADGE_COLORS.yellow });
  assert.deepEqual(badgeStatus(results({ green: 9 })), { label: "Ready to deploy", color: BADGE_COLORS.green });
  assert.deepEqual(badgeStatus(null), { label: "report not found", color: BADGE_COLORS.neutral });
});

test("a path gets a break opportunity after every slash and nothing else changes", () => {
  assert.equal(renderToStaticMarkup(createElement(Breakable, { text: "src/components/Foo.tsx:12" })), "src/<wbr/>components/<wbr/>Foo.tsx:12");
  assert.equal(renderToStaticMarkup(createElement(Breakable, { text: ".env.example" })), ".env.example");
  assert.equal(renderToStaticMarkup(createElement(Breakable, { text: "git add -- 'app/x.ts'" })), "git add -- &#x27;app/<wbr/>x.ts&#x27;");
});

test("CLI flags in guide prose are kept on one line", () => {
  const html = renderToStaticMarkup(createElement(GuideText, { text: "Add the --webpack flag, or run next build --turbopack. The same applies to yarn install --immutable." }));
  assert.equal(html, 'Add the <span class="nowrap">--webpack</span> flag, or run next build <span class="nowrap">--turbopack</span>. The same applies to yarn install <span class="nowrap">--immutable</span>.');
  assert.equal(renderToStaticMarkup(createElement(GuideText, { text: "Adding --no-frozen-lockfile hides the drift." })), 'Adding <span class="nowrap">--no-frozen-lockfile</span> hides the drift.');
  // Ordinary hyphenated words and a text without flags render as they are.
  assert.equal(renderToStaticMarkup(createElement(GuideText, { text: "a case-insensitive disk - not Linux" })), "a case-insensitive disk - not Linux");
  // The published guides do carry flags, so the rule matters.
  const flagged = guides.flatMap((guide) => guide.sections.flatMap((section) => section.body)).filter((paragraph) => /--[a-z]/.test(paragraph));
  assert.ok(flagged.length >= 3);
  for (const paragraph of flagged) assert.match(renderToStaticMarkup(createElement(GuideText, { text: paragraph })), /<span class="nowrap">--[a-z][a-z0-9-]*<\/span>/);
});

/** WCAG relative luminance and contrast ratio for #rrggbb colors. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("the small status text of the report sections reaches 4.5:1 on its backgrounds in light mode", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const token = (name: string) => root.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1] ?? assert.fail(`token ${name}`);
  for (const [text, backgrounds] of [["red-text", ["red-soft", "panel"]], ["yellow-text", ["yellow-soft", "panel"]], ["green-text", ["green-soft", "panel"]]] as const) {
    for (const background of backgrounds) {
      assert.ok(contrast(token(text), token(background)) >= 4.5, `${text} on ${background}: ${contrast(token(text), token(background)).toFixed(2)}`);
    }
  }
  // The sections use the text tokens, not the status colors that fall short on the soft tints.
  for (const selector of [".fix-first strong", ".fix-first.is-yellow strong", ".fix-first li.is-red::marker", ".fix-first li.is-yellow::marker",
    ".since-last-status li.is-better", ".since-last-status li.is-worse", ".since-last .is-fixed h3", ".since-last .is-new h3"]) {
    const rule = css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m"))?.[1] ?? assert.fail(selector);
    assert.match(rule, /color: var\(--(red|yellow|green)-text\)/, selector);
  }
  assert.match(css, /^\.nowrap \{ white-space: nowrap; \}/m);
});
