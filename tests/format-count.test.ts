import assert from "node:assert/strict";
import test from "node:test";
import { formatCount, MIN_REPOS_SHOWN, shownCount } from "../src/lib/format-count";
import { t } from "../src/lib/i18n";

test("the repos-scanned counter groups digits the way each language expects", () => {
  assert.equal(formatCount("en", 1234567), "1,234,567");
  assert.equal(formatCount("sv", 1234567).replace(/\s/g, " "), "1 234 567");
  assert.equal(formatCount("en", 7), "7");
  assert.equal(t("en", "home.trust.scanned"), "repos scanned");
  assert.equal(t("sv", "home.trust.scanned"), "repon skannade");
});

test("the counter stays hidden until 100 repositories have been scanned", () => {
  assert.equal(MIN_REPOS_SHOWN, 100);
  assert.equal(shownCount(null), null);
  assert.equal(shownCount(Number.NaN), null);
  assert.equal(shownCount(18), null);
  assert.equal(shownCount(99), null);
  assert.equal(shownCount(100), 100);
  assert.equal(shownCount(1234), 1234);
});
