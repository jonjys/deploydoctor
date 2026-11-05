import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";
import sitemap from "../src/app/sitemap";
import {
  HUMAN_AUDIT_PAYMENT_URL,
  partnerAuditUrl,
  partnerFallbackMailto,
  partnerMailto,
} from "../src/lib/human-audit";
import { repoFromPath } from "../src/lib/repo-link";
import { plans } from "../src/lib/plans";
import { SITE_URL } from "../src/lib/site";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const OLD_AUDIT_URL = "https://buy.stripe.com/bJe9ASculcZgcKQ52R8og2w";

test("a partner slug is appended as client_reference_id and does not change the €49 link", () => {
  assert.equal(HUMAN_AUDIT_PAYMENT_URL, "https://buy.stripe.com/cNi7sKbqh6ASh169j78og2L");
  assert.equal(partnerAuditUrl("acme"), `${HUMAN_AUDIT_PAYMENT_URL}?client_reference_id=acme`);
  assert.equal(partnerAuditUrl("  Northwind-Studio "), `${HUMAN_AUDIT_PAYMENT_URL}?client_reference_id=northwind-studio`);
  for (const slug of ["", "a", "-acme", "acme-", "ac me", "acme/studio", "a".repeat(65), "../etc"]) {
    assert.equal(partnerAuditUrl(slug), null, slug);
  }
});

test("partner signup mail uses subject Partner plus the agency name", () => {
  const href = partnerMailto({ agency: "Northwind", email: "ada@northwind.example", website: "https://northwind.example", slug: "Northwind" });
  assert.ok(href);
  const url = new URL(href!);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "support@nyttolabs.com");
  assert.equal(url.searchParams.get("subject"), "Partner Northwind");
  const body = url.searchParams.get("body") ?? "";
  assert.match(body, /Slug: northwind/);
  assert.match(body, /client_reference_id=northwind/);
  assert.equal(partnerMailto({ agency: "Northwind\nBcc: x", email: "ada@northwind.example", slug: "northwind" })?.includes("\n"), false);
  assert.equal(partnerMailto({ agency: "", email: "ada@northwind.example", slug: "northwind" }), null);
  assert.equal(partnerMailto({ agency: "Northwind", email: "not-an-email", slug: "northwind" }), null);
  assert.equal(partnerMailto({ agency: "Northwind", email: "ada@northwind.example", slug: "nope slug" }), null);
  assert.equal(partnerFallbackMailto(), "mailto:support@nyttolabs.com?subject=Partner");
});

test("the partners page and homepage audit CTA use the €49 link, and scan pricing stays put", () => {
  const page = read("src/app/partners/page.tsx");
  const home = read("src/app/page.tsx");
  const ci = read("src/app/ci/page.tsx");
  assert.match(page, /Earn 30%/);
  assert.match(page, /€49/);
  assert.match(page, /within 48 hours/);
  assert.match(page, /client_reference_id/);
  assert.match(page, /support@nyttolabs.com/);
  assert.match(page, /HUMAN_AUDIT_PAYMENT_URL/);
  assert.match(page, /paid manually/);
  assert.doesNotMatch(page, /testimonial|trusted by|customers served|★|5\.0/i);
  assert.match(home, /href=\{HUMAN_AUDIT_PAYMENT_URL\}/);
  assert.match(home, /Human-reviewed audit of one repo within 48 hours, €49/);
  assert.match(home, /href="\/partners"/);
  assert.match(ci, /€49 human audit/);
  for (const file of [page, home, ci, read("src/lib/human-audit.ts")]) {
    assert.doesNotMatch(file, /€149/);
    assert.doesNotMatch(file, new RegExp(OLD_AUDIT_URL.replace(/[/.]/g, "\\$&")));
  }
  assert.equal(plans.day.usd, "$2");
  assert.equal(plans.week.usd, "$5");
  assert.equal(plans.public.usd, "$9");
  assert.equal(plans["fix-one"].usd, "$5");
  const urls = sitemap().map((entry) => entry.url);
  assert.ok(urls.includes(`${SITE_URL}/partners`));
  assert.equal(repoFromPath(["partners", "acme"]), null);
  assert.equal(repoFromPath(["partner", "acme"]), null);
});

test("/partner redirects to /partners", async () => {
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(redirects, [{ source: "/partner", destination: "/partners", permanent: false }]);
});
