import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScanPassCta } from "../src/components/scan-pass-cta";
import { LANGS, t } from "../src/lib/i18n";
import { planPrice } from "../src/lib/plans";

test("the report offers the 24-hour pass with its real price and the existing checkout link", () => {
  for (const lang of LANGS) {
    const html = renderToStaticMarkup(createElement(ScanPassCta, { t: (key) => t(lang, key), repoUrl: "https://github.com/acme/shop" }));
    assert.match(html, /href="\/checkout\?plan=day"/, lang);
    assert.match(html, /href="\/pricing"/, lang);
    assert.ok(html.includes(planPrice("day", lang)), `${lang} names the price`);
    // No urgency, no counters, no made-up numbers.
    assert.doesNotMatch(html, /hurry|limited time|only \d|left|\d+ (people|users|customers)/i, lang);
  }
});

test("the report page shows the pass offer to every visitor without a pass, not only after a failed check", () => {
  const page = readFileSync(new URL("../src/app/r/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ ScanPassCta \} from "@\/components\/scan-pass-cta";/);
  assert.match(page, /\{!plan && <ScanPassCta t=\{t\} repoUrl=\{report\.repo_url\} \/>\}/);
  // It sits under the findings and above the coverage details.
  assert.ok(page.indexOf("<ScanPassCta") > page.indexOf('id="checks"'));
  assert.ok(page.indexOf("<ScanPassCta") < page.indexOf(`<summary>{t("report.coverageDetails")}`));
});

test("the limit-reached state still offers the pass through the same checkout button", () => {
  const form = readFileSync(new URL("../src/components/repo-form.tsx", import.meta.url), "utf8");
  assert.match(form, /\{paywall && <div className="paywall"[\s\S]*<ScanCheckoutButton plan="day"/);
});
