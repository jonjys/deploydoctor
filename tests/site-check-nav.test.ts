import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("nav links to the Site check tool", () => {
  const src = readFileSync("src/components/site-nav.tsx", "utf8");
  assert.match(src, /href="https:\/\/sellscore\.nyttolabs\.com"[^>]*>Site check</);
});
