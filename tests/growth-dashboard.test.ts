import test from "node:test";
import assert from "node:assert/strict";
import { issueGrowthSession, usableGrowthPassword, validGrowthPassword, verifyGrowthSession } from "../src/lib/growth-auth";

const password = "sample-demo-only-password-at-least-24";

test("owner dashboard requires a strong password", () => {
  assert.equal(usableGrowthPassword(undefined), false);
  assert.equal(usableGrowthPassword("123456"), false);
  assert.equal(usableGrowthPassword(password), true);
  assert.equal(validGrowthPassword(password, password), true);
  assert.equal(validGrowthPassword("wrong", password), false);
  assert.equal(validGrowthPassword(password, ""), false);
});

test("signed owner session expires and cannot be forged", () => {
  const now = Date.UTC(2026, 9, 21, 21, 0, 0);
  const token = issueGrowthSession(password, now);
  assert.equal(verifyGrowthSession(token, password, now + 1000), true);
  assert.equal(verifyGrowthSession(token, "different-but-long-enough-password", now), false);
  assert.equal(verifyGrowthSession(token + "x", password, now), false);
  assert.equal(verifyGrowthSession(token, password, now + 9 * 3600 * 1000), false);
  assert.equal(verifyGrowthSession("invalid", password), false);
});
