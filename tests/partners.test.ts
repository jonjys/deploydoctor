import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";
import sitemap from "../src/app/sitemap";
import { DRAFT_HUMAN_AUDIT_PAYMENT_URL, draftPartnerAuditUrl } from "../src/lib/human-audit-draft";
import { partnerFallbackMailto, partnerMailto, partnerSlugQuery } from "../src/lib/human-audit";
import { repoFromPath } from "../src/lib/repo-link";
import { plans } from "../src/lib/plans";
import { SITE_URL } from "../src/lib/site";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const DISABLED = "https://buy.stripe.com/00w5kC9i91gybGMgLz8og2K";
const PUBLIC_AUDIT = "https://buy.stripe.com/bJe9ASculcZgcKQ52R8og2w";

test("the unpublished audit link accepts a partner slug and is not the disabled link", () => {
  assert.equal(DRAFT_HUMAN_AUDIT_PAYMENT_URL, "https://buy.stripe.com/cNi7sKbqh6ASh169j78og2L");
  assert.notEqual(DRAFT_HUMAN_AUDIT_PAYMENT_URL, DISABLED);
  assert.equal(draftPartnerAuditUrl("acme"), `${DRAFT_HUMAN_AUDIT_PAYMENT_URL}?client_reference_id=acme`);
  assert.equal(draftPartnerAuditUrl("  Northwind-Studio "), `${DRAFT_HUMAN_AUDIT_PAYMENT_URL}?client_reference_id=northwind-studio`);
  assert.equal(partnerSlugQuery("acme"), "client_reference_id=acme");
  for (const slug of ["", "a", "-acme", "acme-", "ac me", "acme/studio", "a".repeat(65)]) {
    assert.equal(draftPartnerAuditUrl(slug), null, slug);
    assert.equal(partnerSlugQuery(slug), null, slug);
  }
});

test("partner signup mail uses subject Partner plus the agency name and no payment URL", () => {
  const href = partnerMailto({ agency: "Northwind", email: "ada@northwind.example", website: "https://northwind.example", slug: "Northwind" });
  assert.ok(href);
  const url = new URL(href!);
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "support@nyttolabs.com");
  assert.equal(url.searchParams.get("subject"), "Partner Northwind");
  const body = url.searchParams.get("body") ?? "";
  assert.match(body, /Slug: northwind/);
  assert.match(body, /client_reference_id=northwind/);
  assert.doesNotMatch(body, /buy\.stripe\.com/);
  assert.equal(partnerMailto({ agency: "Northwind\nBcc: x", email: "ada@northwind.example", slug: "northwind" })?.includes("\n"), false);
  assert.equal(partnerMailto({ agency: "", email: "ada@northwind.example", slug: "northwind" }), null);
  assert.equal(partnerMailto({ agency: "Northwind", email: "not-an-email", slug: "northwind" }), null);
  assert.equal(partnerFallbackMailto(), "mailto:support@nyttolabs.com?subject=Partner");
});

test("the partners page documents tracking and does not publish a price or payment link", () => {
  const page = read("src/app/partners/page.tsx");
  const desk = read("src/components/partner-desk.tsx");
  const home = read("src/app/page.tsx");
  assert.match(page, /client_reference_id/);
  assert.match(page, /does not publish a price/);
  assert.match(page, /support@nyttolabs.com/);
  assert.match(page, /30%/);
  assert.doesNotMatch(page, /€49|€149|€15|buy\.stripe\.com/);
  assert.doesNotMatch(desk, /buy\.stripe\.com|€49|€149/);
  assert.doesNotMatch(`${page}\n${desk}\n${read("src/lib/human-audit.ts")}`, new RegExp(DRAFT_HUMAN_AUDIT_PAYMENT_URL.replace(/[/.]/g, "\\$&")));
  assert.doesNotMatch(`${page}\n${desk}\n${home}`, /00w5kC9i91gybGMgLz8og2K/);
  assert.match(home, /Deploy Rescue/);
  assert.match(home, /buy\.stripe\.com\/bJebJ0eCt0cu3ag2UJ8og2I/);
  assert.doesNotMatch(home, /HUMAN SECOND OPINION|One repo audit|Manuell repogranskning|€149/);
  assert.doesNotMatch(home, new RegExp(PUBLIC_AUDIT.replace(/[/.]/g, "\\$&")));
  assert.match(home, /id="scan-repository"/);
  assert.match(home, /Automated PR repair is not enabled yet/);
  assert.match(read("src/app/fix/page.tsx"), /fixPullRequestsEnabled\(\)/);
  assert.match(read("src/app/fix/page.tsx"), /fix\.leadOff/);
  assert.match(read("src/components/fix-form.tsx"), /purchasesEnabled && offer\.eligible/);
  assert.equal(plans.day.usd, "$2");
  assert.equal(plans.week.usd, "$5");
  assert.equal(plans.public.usd, "$9");
  const urls = sitemap().map((entry) => entry.url);
  assert.ok(urls.includes(`${SITE_URL}/partners`));
  assert.equal(repoFromPath(["partners", "acme"]), null);
  assert.equal(repoFromPath(["partner", "acme"]), null);
});

test("/partner redirects to /partners", async () => {
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(redirects.filter((rule) => rule.source === "/partner"), [{ source: "/partner", destination: "/partners", permanent: false }]);
});
