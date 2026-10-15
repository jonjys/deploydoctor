import assert from "node:assert/strict";
import test from "node:test";
import { clonedRepo } from "../src/lib/vercel-log";
import { LANGS, t } from "../src/lib/i18n";

test("a Vercel build log names the repository it cloned", () => {
  assert.equal(clonedRepo("Cloning github.com/vercel/commerce (Branch: main, Commit: abc1234)\nCloning completed: 1.2s"), "vercel/commerce");
  assert.equal(clonedRepo("21:04:11.120 Running build in Washington, D.C., USA (East)\n21:04:11.300 Cloning github.com/my-org/web.app_2 (Branch: feat/x, Commit: 9f8e7d6)"), "my-org/web.app_2");
});

test("a log without the clone line offers no repository", () => {
  assert.equal(clonedRepo("Module not found: Can't resolve './Thing'\nError: Command \"npm run build\" exited with 1"), null);
  assert.equal(clonedRepo("Cloning gitlab.com/group/project (Branch: main, Commit: abc1234)"), null);
  assert.equal(clonedRepo("Cloning github.com/vercel/commerce"), null);
});

test("the offers under a diagnosis exist in every language and keep the copy rules", () => {
  for (const lang of LANGS) {
    const copy = [t(lang, "diag.scanRepo", { repo: "vercel/commerce" }), t(lang, "diag.rescue.body"), t(lang, "diag.rescue.cta"), t(lang, "report.dayCta")];
    assert.match(copy[0], /vercel\/commerce/);
    for (const text of copy) assert.doesNotMatch(text, /[–—"“”]/, text);
  }
  assert.match(t("en", "diag.rescue.cta"), /\$2/);
  assert.match(t("sv", "diag.rescue.cta"), /19 kr/);
  assert.match(t("sv", "report.dayCta"), /19 kr/);
});
