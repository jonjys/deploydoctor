import assert from "node:assert/strict";
import test from "node:test";
import { formatCount } from "../src/lib/format-count";
import { t } from "../src/lib/i18n";

test("the repos-scanned counter groups digits the way each language expects", () => {
  assert.equal(formatCount("en", 1234567), "1,234,567");
  assert.equal(formatCount("sv", 1234567).replace(/\s/g, " "), "1 234 567");
  assert.equal(formatCount("en", 7), "7");
  assert.equal(t("en", "home.trust.scanned"), "repos scanned");
  assert.equal(t("sv", "home.trust.scanned"), "repon skannade");
});
