import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("nav links to DeployDoctor's own live site check", () => {
  const src = readFileSync("src/components/site-nav.tsx", "utf8");
  assert.match(src, /<Link href="\/site-check"[^>]*>\{t\("nav.siteCheck"\)\}</);
});
