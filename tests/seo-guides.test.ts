import test from "node:test";
import assert from "node:assert/strict";
import { seoGuides } from "../src/lib/seo-guides";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guides, guideBySlug, relatedGuides, type Guide } from "../src/lib/guides";

test("ten new guides have distinct and useful search intents", () => {
  assert.equal(seoGuides.length, 10);
  const slugs = guides.map((guide) => guide.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const guide of seoGuides) {
    assert.match(guide.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(guide.title.length >= 35);
    assert.ok(guide.description.length >= 60);
    assert.equal(guide.updated, "2026-10-21");
    assert.ok(guide.sections.length >= 4);
    assert.ok(guide.sections.every((section) => section.body.length > 0));
    assert.equal(guideBySlug(guide.slug)?.title, guide.title);
  }
  // Not every failure mode needs a configuration snippet; runtime diagnosis and
  // dashboard settings should not have fabricated code just to satisfy a test.
  assert.ok(seoGuides.filter((guide) => guide.sections.some((section) => Boolean(section.code))).length >= 7);
});

test("more guides lists the same check first, then fills in catalog order, three items, never the guide itself", () => {
  for (const guide of guides) {
    const related = relatedGuides(guide);
    assert.equal(related.length, 3, guide.slug);
    assert.ok(related.every((other) => other.slug !== guide.slug), guide.slug);
    assert.equal(new Set(related.map((other) => other.slug)).size, 3, guide.slug);
    assert.deepEqual(relatedGuides(guide).map((other) => other.slug), related.map((other) => other.slug), "deterministic");
    const sameCheck = guides.filter((other) => other.slug !== guide.slug && other.check === guide.check).slice(0, 3);
    assert.deepEqual(related.slice(0, sameCheck.length).map((other) => other.slug), sameCheck.map((other) => other.slug), guide.slug);
    assert.ok(related.slice(sameCheck.length).every((other) => other.check !== guide.check), guide.slug);
  }
  // A build configuration guide links other build configuration guides instead of the three oldest guides.
  const vite = guideBySlug("vite-spa-vercel-deep-link-404")!;
  assert.ok(relatedGuides(vite).every((other) => other.check === "Build configuration"));
  assert.notDeepEqual(relatedGuides(vite).map((other) => other.slug), guides.slice(0, 3).map((other) => other.slug));
  // With fewer than three on the same check, the rest fills from the catalog in order.
  const fixture = (slug: string, check: string): Guide => ({ slug, title: slug, description: slug, updated: "2026-10-21", check, sections: [] });
  const catalog = [fixture("a", "Env"), fixture("b", "Build"), fixture("c", "Env"), fixture("d", "Build"), fixture("e", "Supabase")];
  assert.deepEqual(relatedGuides(catalog[2], catalog).map((other) => other.slug), ["a", "b", "d"]);
  assert.deepEqual(relatedGuides(catalog[4], catalog).map((other) => other.slug), ["a", "b", "c"]);
  assert.deepEqual(relatedGuides(catalog[0], catalog, 2).map((other) => other.slug), ["c", "b"]);
  // The guide page renders that list.
  assert.match(readFileSync(join(__dirname, "..", "src/app/guides/[slug]/page.tsx"), "utf8"), /const others = relatedGuides\(guide\);/);
});

test("new guides remain linked to canonical guide route and sitemap collection", () => {
  assert.ok(guides.length >= 21);
  for (const guide of seoGuides) {
    assert.ok(guides.some((item) => item.slug === guide.slug));
    assert.ok(guide.description !== guide.title);
  }
});
