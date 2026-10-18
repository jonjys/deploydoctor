import test from "node:test";
import assert from "node:assert/strict";
import { recentRepositories } from "../src/lib/recent-scans";

const now = 1_800_000_000_000;
test("return visits show the last opened report per repo, newest first", () => {
  assert.deepEqual(recentRepositories([
    { id: "old", repo: "acme/site", at: now - 50 },
    { id: "other", repo: "acme/docs", at: now - 20 },
    { id: "latest", repo: "https://github.com/ACME/site", at: now - 10 },
  ], now), [
    { id: "latest", repo: "https://github.com/ACME/site", at: now - 10 },
    { id: "other", repo: "https://github.com/acme/docs", at: now - 20 },
  ]);
});
test("invalid or stale browser storage cannot break the return view or create unsafe report links", () => {
  for (const value of [null, {}, "broken", 5]) assert.deepEqual(recentRepositories(value, now), []);
  assert.deepEqual(recentRepositories([
    null, {}, { id: "../account", repo: "acme/site", at: now },
    { id: "ok", repo: "javascript:alert(1)", at: now },
    { id: "ok", repo: "acme/site", at: "yesterday" },
    { id: "ok", repo: "acme/site", at: now + 1 },
    { id: "ok", repo: "acme/site", at: now - 14 * 86400000 },
  ], now), []);
});
test("the home view has at most three repositories", () => {
  assert.equal(recentRepositories(Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, repo: `acme/site${i}`, at: now - i })), now).length, 3);
});
