import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("live site check is still reachable from the responsive More menu", () => {
  const src = readFileSync("src/components/site-nav.tsx", "utf8");
  assert.match(src, /href: "\/site-check"/);
  assert.match(src, /moreItems/);
  assert.match(src, /className=\{styles\.mobile\}/);
  assert.match(src, /href: "\/safe"/);
});
