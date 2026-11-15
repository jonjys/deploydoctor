import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config";
import { consolidatedErrors, consolidatedGuide, errorPagePath } from "../src/lib/seo-routes";
import { errorPageBySlug, activeErrorPages } from "../src/lib/error-pages";
import { guideBySlug } from "../src/lib/guides";
import { incidentPages } from "../src/lib/incident-pages";
import sitemap from "../src/app/sitemap";

test("retired references redirect directly to an existing guide that preserves their troubleshooting", async () => {
  const rules = await nextConfig.redirects!();
  const urls = sitemap().map((entry) => new URL(entry.url).pathname);
  assert.equal(Object.keys(consolidatedErrors).length, 5);
  for (const [error, target] of Object.entries(consolidatedErrors)) {
    const guide = guideBySlug(target)!;
    assert.ok(guide, target);
    assert.ok(!urls.includes(`/errors/${error}`));
    assert.equal(urls.filter((url) => url === `/guides/${target}`).length, 1);
    assert.ok(!activeErrorPages.some((page) => page.slug === error));
    assert.ok(rules.some((r) => r.source === `/errors/${error}` && r.destination === errorPagePath(error) && r.permanent));
    const reference = errorPageBySlug(error)!;
    for (const section of reference.sections) assert.ok(guide.sections.some((s) => s.heading === `Error reference: ${section.heading}`));
    for (const doc of reference.docs) assert.ok(guide.docs?.some((d) => d.url === doc.url));
  }
});

test("unknown error slugs do not resolve through object prototypes", () => {
  for (const slug of ["constructor", "toString", "__proto__", "not-an-error"]) {
    assert.equal(consolidatedGuide(slug), undefined);
    assert.equal(errorPagePath(slug), `/errors/${slug}`);
  }
});

test("eight new problems are discoverable with verification limits and explicit sources", () => {
  assert.equal(incidentPages.length, 8);
  const urls = sitemap().map((entry) => new URL(entry.url).pathname);
  for (const page of incidentPages) {
    assert.ok(activeErrorPages.includes(page));
    assert.ok(urls.includes(`/errors/${page.slug}`));
    assert.ok(page.docs.length >= 2);
    assert.ok(page.sections.some((s) => s.steps && s.steps.length >= 4));
    assert.match(page.scanNote, /cannot inspect/);
  }
  const lovable = errorPageBySlug("lovable-vercel-build-failed")!;
  assert.match(JSON.stringify(lovable.sections), /TanStack Start/);
  assert.match(JSON.stringify(lovable.sections), /not every exported application/);
});
