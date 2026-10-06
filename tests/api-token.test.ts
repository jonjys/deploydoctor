import assert from "node:assert/strict";
import test from "node:test";

import { signApiToken, verifyApiToken, verifySession, signSession, API_TOKEN_PREFIX } from "../src/lib/session-token";
import { parseGitRef } from "../src/lib/git-ref";

// The signing secret is read on every call, so setting it after the import is enough.
process.env.SESSION_SECRET = "test-secret-with-at-least-thirty-two-characters";

const customer = { email: "dev@example.com", customerId: "cus_123abc" };

test("an API token round-trips and carries the customer", () => {
  const token = signApiToken(customer);
  assert.ok(token.startsWith(API_TOKEN_PREFIX));
  const verified = verifyApiToken(token);
  assert.equal(verified?.customerId, customer.customerId);
  assert.equal(verified?.email, customer.email);
  assert.ok((verified?.expiresAt ?? 0) > Date.now() + 300 * 86_400_000);
});

test("API tokens and session cookies are not interchangeable", () => {
  const token = signApiToken(customer);
  assert.equal(verifySession(token), null);
  assert.equal(verifySession(token.slice(API_TOKEN_PREFIX.length)), null);
  const cookie = signSession({ ...customer, expiresAt: Date.now() + 60_000 });
  assert.equal(verifyApiToken(cookie), null);
  assert.equal(verifyApiToken(`${API_TOKEN_PREFIX}${cookie}`), null);
});

test("a tampered or malformed API token is rejected", () => {
  const token = signApiToken(customer);
  const [payload, signature] = token.slice(API_TOKEN_PREFIX.length).split(".");
  const other = Buffer.from(JSON.stringify({ ...customer, customerId: "cus_other" })).toString("base64url");
  assert.equal(verifyApiToken(`${API_TOKEN_PREFIX}${other}.${signature}`), null);
  assert.equal(verifyApiToken(`${API_TOKEN_PREFIX}${payload}.${"0".repeat(64)}`), null);
  assert.equal(verifyApiToken(""), null);
  assert.equal(verifyApiToken(undefined), null);
  assert.equal(verifyApiToken("Bearer nope"), null);
});

test("git refs are validated the way git would", () => {
  assert.equal(parseGitRef(undefined), undefined);
  assert.equal(parseGitRef(""), undefined);
  assert.equal(parseGitRef("main"), "main");
  assert.equal(parseGitRef("feature/ci-check"), "feature/ci-check");
  assert.equal(parseGitRef("v1.2.3"), "v1.2.3");
  assert.equal(parseGitRef("240609471dcb41f029d96d29ac793a2e3fec1f3c"), "240609471dcb41f029d96d29ac793a2e3fec1f3c");
  assert.equal(parseGitRef("refs/pull/12/head"), "refs/pull/12/head");
  for (const bad of ["-rf", "a..b", "has space", "x~1", "x^2", "a:b", "q?", "a*", "[x]", "back\\slash", "../etc", "a//b", "feature/", "x@{1}", "a.lock", "x".repeat(201), 42])
    assert.equal(parseGitRef(bad), null, String(bad));
});
