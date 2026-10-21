import test from "node:test";
import assert from "node:assert/strict";
import { seoGuides } from "../src/lib/seo-guides";
import { guides, guideBySlug } from "../src/lib/guides";

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

test("new guides remain linked to canonical guide route and sitemap collection", () => {
  assert.ok(guides.length >= 21);
  for (const guide of seoGuides) {
    assert.ok(guides.some((item) => item.slug === guide.slug));
    assert.ok(guide.description !== guide.title);
  }
});
