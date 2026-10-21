import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messages } from "../src/lib/i18n";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

test("watch copy describes the real flow: a link that opens a page with a button, and limits that reset at midnight UTC", () => {
  for (const lang of ["en", "sv"] as const) {
    const watch = Object.entries(messages[lang]).filter(([key]) => key.startsWith("watch."));
    assert.ok(watch.length > 20, `${lang} has watch strings`);
    for (const [key, text] of watch) {
      // Opening a link never confirms or unsubscribes, so nothing is one click.
      assert.doesNotMatch(text, /one[- ]click|ett klick/i, `${lang} ${key}`);
      // Visitor copy carries no dashes or quotation marks.
      assert.doesNotMatch(text, /[–—"“”]/, `${lang} ${key}`);
    }
    assert.match(messages[lang]["watch.limitIp"], /UTC/);
    assert.ok(messages[lang]["watch.failedTitle"]);
  }
  assert.equal(messages.sv["watch.unavailable"], "Bevakning av repon är inte påslagen än.");
  assert.doesNotMatch(Object.values(messages.sv).filter((text) => /bevak/i.test(text)).join("\n"), /offentlig/i, "the site says publika, not offentliga");
  assert.doesNotMatch(messages.sv["watch.unsubscribeButton"], /Avregistrera/);
  // The confirm and unsubscribe buttons answer with a page, also when the database is unavailable.
  assert.match(read("src/app/api/watch/confirm/route.ts"), /return result\(request, "failed"\)/);
  assert.match(read("src/app/api/watch/unsubscribe/route.ts"), /if \(fromPage\) \{ target\.searchParams\.set\("state", "failed"\)/);
  assert.match(read("src/app/watch/page.tsx"), /state === "failed"/);
});

test("the free GitHub Action allowance is stated everywhere, and only the daily limit is reported as one", () => {
  assert.match(read("src/app/pricing/page.tsx"), /t\("pricing\.freeCi"\)/);
  for (const lang of ["en", "sv"] as const) assert.match(messages[lang]["pricing.freeCi"], /1/);
  assert.match(read("src/app/ci/page.tsx"), /more than 1 scan a day/);
  assert.match(read("README.md"), /id-token: write/);
  // A GitHub rate limit is also a 429; only the scan route's paywall answer is the day's allowance.
  assert.match(read("action/scan.mjs"), /response\.status === 429 && data\?\.paywall === true/);
  assert.match(read("src/lib/mcp.ts"), /response\.status === 429 && data\.paywall === true/);
  // The MCP plans tool lists what /pricing sells, in the singular the free level has.
  assert.match(read("src/lib/mcp.ts"), /\["day", "week", "public"\]\.map/);
  assert.doesNotMatch(read("src/lib/mcp.ts"), /exhausted free scans/);
  // The guide CTA is true for every guide, Astro and SvelteKit ones included.
  assert.doesNotMatch(read("src/app/guides/[slug]/page.tsx"), /plus eight more/);
});
