import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issueGrowthSession, usableGrowthPassword, validGrowthPassword, verifyGrowthSession } from "../src/lib/growth-auth";

const page = readFileSync(join(__dirname, "..", "src/app/growth/page.tsx"), "utf8");

const password = "sample-demo-only-password-at-least-24";

test("owner dashboard requires a strong password", () => {
  assert.equal(usableGrowthPassword(undefined), false);
  assert.equal(usableGrowthPassword("123456"), false);
  assert.equal(usableGrowthPassword(password), true);
  assert.equal(validGrowthPassword(password, password), true);
  assert.equal(validGrowthPassword("wrong", password), false);
  assert.equal(validGrowthPassword(password, ""), false);
});

test("an unconfigured Growth HQ is a 404 for visitors; the configured one keeps the login card", () => {
  assert.match(page, /import \{ notFound \} from "next\/navigation";/);
  // Not configured: warn on the server and throw the 404 before anything renders or the cookie is read.
  assert.match(page, /if \(!configured\) \{\n(?:\s*\/\/.*\n)?\s*console\.warn\("Growth HQ is not configured[^"]*"\);\n\s*notFound\(\);\n\s*\}/);
  assert.ok(page.indexOf("notFound();") < page.indexOf("cookies()"), "404 decided before the session cookie is read");
  assert.doesNotMatch(page, /not configured\. Add a strong|then redeploy\.<\/p>/, "no setup instructions in the page");
  assert.doesNotMatch(page, /\{!configured \?/);
  // Configured but signed out: the login card posts to the session route.
  assert.match(page, /if \(!authorized\) return <main/);
  assert.match(page, /<form action="\/growth\/session" method="post" className="growth-login">/);
  assert.match(page, /Incorrect password\./);
});

test("Growth HQ shows n/a for a missing number and one kicker label", () => {
  assert.doesNotMatch(page, /[\u2013\u2014]/, "no dash placeholders or dashes in copy");
  assert.equal((page.match(/: "n\/a"\}/g) ?? []).length, 4, "four metric tiles fall back to n/a");
  assert.match(page, /n\/a is not zero/);
  assert.match(page, /const KICKER = "PRIVATE • DEPLOYDOCTOR";/);
  assert.equal((page.match(/className="section-kicker">\{KICKER\}<\/p>/g) ?? []).length, 2);
  assert.doesNotMatch(page, /NYTTOLABS/);
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
