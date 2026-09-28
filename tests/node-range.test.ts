import assert from "node:assert/strict";
import test from "node:test";
import { nodeRangeAllowsMajor } from "../src/lib/node-range";

const supported = (range: string) => nodeRangeAllowsMajor(range, [20, 22, 24]);

test("ranges that allow a Node version Vercel builds with", () => {
  for (const range of ["20.x", ">=18", "^22", "~24.1", "18 || 20", ">=18.17.0 <25", "*", "", "20.11.1", ">= 20", "v22.x", "<=20", "16 - 22"]) {
    assert.equal(supported(range), true, range);
  }
});

test("ranges that rule out Node 20, 22 and 24", () => {
  for (const range of ["18.x", "16", "^18.17.0", "<20", ">=25", "~21.1", "14 || 16 || 18", "19.x || 21.x || 23.x", ">=18 <20", "12 - 18"]) {
    assert.equal(supported(range), false, range);
  }
});

test("ranges that cannot be parsed are unknown", () => {
  assert.equal(supported("lts/*"), null);
  assert.equal(supported("node"), null);
});
