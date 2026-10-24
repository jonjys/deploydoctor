import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../src/app/badge.svg/route";
import { ReadmeBadges, reportBadgeMarkdown, scanButtonMarkdown } from "../src/components/readme-badges";
import { messages } from "../src/lib/i18n";
import { BADGE_COLORS, BADGE_INK, badgeSvg } from "../src/lib/report-badge";
import { repoFromPath } from "../src/lib/repo-link";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const site = "https://deploydoctor.nyttolabs.com";
const id = "4e515536-d2b3-474f-884e-b4498baa878f";

test("GET /badge.svg is the Scan with DeployDoctor button: one SVG for everyone, cached for a day, no database", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  const cache = response.headers.get("cache-control") ?? "";
  assert.match(cache, /^public, /);
  assert.ok(Number(/max-age=(\d+)/.exec(cache)?.[1]) >= 86_400, cache);
  assert.ok(Number(/s-maxage=(\d+)/.exec(cache)?.[1]) >= 86_400, cache);
  const svg = await response.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="Scan with DeployDoctor">/);
  assert.match(svg, /<title>Scan with DeployDoctor<\/title>/);
  assert.match(svg, />Scan with<\/text>/);
  assert.match(svg, />DeployDoctor<\/text>/);
  assert.match(svg, new RegExp(`fill="${BADGE_COLORS.neutral}"`));
  assert.match(svg, new RegExp(`fill="${BADGE_INK}"`));
  // The same bytes on every call: the route reads no report, no database and nothing from the request.
  assert.equal(await GET().text(), svg);
  const source = read("src/app/badge.svg/route.ts");
  assert.match(source, /export function GET\(\)/);
  assert.doesNotMatch(source, /@\/lib\/(reports|db|access|supabase-sql)|next\/headers/);
  // A single segment never reaches the [owner]/[repo] scan route, and nothing under it reads as a repository.
  assert.equal(repoFromPath(["badge.svg", "x"]), null);
});

test("the report badge keeps its look: DeployDoctor on ink, the headline on the status color, text escaped", () => {
  const svg = badgeSvg({ left: "DeployDoctor", right: "Ready to deploy", color: BADGE_COLORS.green });
  assert.match(svg, /aria-label="DeployDoctor: Ready to deploy"/);
  assert.match(svg, /<title>DeployDoctor: Ready to deploy<\/title>/);
  assert.match(svg, new RegExp(`<rect width="\\d+" height="20" fill="${BADGE_INK}"/>`));
  assert.match(svg, new RegExp(`<rect x="\\d+" width="\\d+" height="20" fill="${BADGE_COLORS.green}"/>`));
  assert.match(badgeSvg({ left: "a<b", right: "c&d \"e\"", color: "#000" }), /a&lt;b[\s\S]*c&amp;d &quot;e&quot;/);
  assert.match(read("src/app/r/[id]/badge/route.ts"), /badgeSvg\(\{ left: "DeployDoctor", right: status, color \}\)/);
});

test("a public report offers both README snippets: its own badge and, below it, the scan button of its repository", () => {
  const button = `[![Scan with DeployDoctor](${site}/badge.svg)](${site}/acme/shop)`;
  assert.equal(scanButtonMarkdown("acme", "shop"), button);
  assert.equal(reportBadgeMarkdown(id), `[![DeployDoctor](${site}/r/${id}/badge)](${site}/r/${id})`);
  const html = renderToStaticMarkup(createElement(ReadmeBadges, { id, owner: "acme", name: "shop", overall: "Ready to deploy", lang: "en" }));
  assert.ok(html.includes(`<code>${button}</code>`), html);
  assert.ok(html.includes(`<code>${reportBadgeMarkdown(id)}</code>`), html);
  assert.ok(html.includes('<img src="/badge.svg" alt="Scan with DeployDoctor" height="20"/>'), html);
  assert.ok(html.includes(`<img src="/r/${id}/badge" alt="DeployDoctor: Ready to deploy" height="20"/>`), html);
  assert.ok(html.indexOf('id="badge-heading"') < html.indexOf('id="scan-button-heading"'), "the badge comes first");
  assert.match(html, /Scan button for your README/);
  assert.match(html, /For templates and starters, so people who fork it can check their copy before the first deploy\./);
  assert.equal(html.match(/>Copy markdown</g)?.length, 2);
  const sv = renderToStaticMarkup(createElement(ReadmeBadges, { id, owner: "acme", name: "shop", overall: "Klar att driftsätta", lang: "sv" }));
  assert.match(sv, /Skanningsknapp till din README/);
  assert.equal(sv.match(/>Kopiera markdown</g)?.length, 2);
  // The report page renders the snippets for public reports only, with the repository the report was made from.
  const page = read("src/app/r/[id]/page.tsx");
  assert.match(page, /\{!report\.is_private && <ReadmeBadges id=\{id\} owner=\{results\.repository\.owner\} name=\{results\.repository\.name\} overall=\{overall\} lang=\{lang\} \/>\}/);
  assert.doesNotMatch(page, /badgeMarkdown|className="badge-section"/);
  // The button links to the instant scan link, which the [owner]/[repo] route turns into a scan from the home page.
  assert.equal(repoFromPath(["acme", "shop"]), "acme/shop");
});

test("the scan button copy exists in both languages without dashes or quotation marks, and /ci mentions the button", () => {
  for (const lang of ["en", "sv"] as const) {
    for (const key of ["report.scanButtonTitle", "report.scanButtonBody"] as const) {
      assert.ok(messages[lang][key].length > 10, `${lang} ${key}`);
      assert.doesNotMatch(messages[lang][key], /[–—"“”]/, `${lang} ${key}`);
    }
    assert.match(messages[lang]["report.scanButtonTitle"], /README/);
    // Forks keep the README, so the copy says what to change.
    assert.match(messages[lang]["report.scanButtonBody"], /owner\/repo/);
  }
  const ci = read("src/app/ci/page.tsx");
  assert.match(ci, /<p>Maintaining a template or starter\? Every public report also offers a Scan with DeployDoctor button for its README, so people who fork it can check their copy before the first deploy\.<\/p>/);
});
