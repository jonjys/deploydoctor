import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorPageBySlug, errorPages, otherErrorPages, type ErrorPage } from "../src/lib/error-pages";
import { guideBySlug } from "../src/lib/guides";
import { plans } from "../src/lib/plans";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** Every string a visitor can read on one page, so copy rules apply to all of it. */
function visibleText(page: ErrorPage): string[] {
  return [
    page.title, page.description, page.errorText ?? "", page.scanNote,
    ...page.docs.map((doc) => doc.label),
    ...page.sections.flatMap((section) => [section.heading, ...(section.body ?? []), ...(section.steps ?? []), section.code ?? ""]),
  ];
}

test("there are at least eight error pages with unique slugs, titles and descriptions", () => {
  assert.ok(errorPages.length >= 8);
  for (const field of ["slug", "title", "description"] as const) {
    const values = errorPages.map((page) => page[field]);
    assert.equal(new Set(values).size, values.length, `${field} is unique`);
  }
  for (const page of errorPages) {
    assert.match(page.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, page.slug);
    assert.ok(page.description.length >= 60 && page.description.length <= 200, `${page.slug} description length ${page.description.length}`);
    assert.match(page.updated, /^\d{4}-\d{2}-\d{2}$/, page.slug);
    assert.ok(page.sections.length >= 2, `${page.slug} has sections`);
    assert.ok(page.sections.some((section) => (section.steps?.length ?? 0) >= 3), `${page.slug} lists fix steps`);
  }
});

test("the pages cover the errors the site targets", () => {
  const text = errorPages.map((page) => `${page.slug} ${page.title} ${page.errorText ?? ""}`).join("\n");
  for (const needle of [/exited with 1/, /environment variable/i, /NOT_FOUND/, /Module not found/, /FUNCTION_INVOCATION_TIMEOUT/, /INTERNAL_SERVER_ERROR|Internal Server Error/, /No Output Directory/, /Node\.js version/i, /secret|key/i]) {
    assert.match(text, needle);
  }
});

test("every page cites official documentation and no source is repeated within a page", () => {
  const hosts = new Set(["vercel.com", "nextjs.org", "docs.github.com"]);
  for (const page of errorPages) {
    assert.ok(page.docs.length >= 1, `${page.slug} cites a source`);
    assert.ok(page.docs.some((doc) => new URL(doc.url).hostname !== "docs.github.com"), `${page.slug} cites Vercel or Next.js`);
    const urls = page.docs.map((doc) => doc.url);
    assert.equal(new Set(urls).size, urls.length, `${page.slug} sources are unique`);
    for (const doc of page.docs) {
      const url = new URL(doc.url);
      assert.equal(url.protocol, "https:", doc.url);
      assert.ok(hosts.has(url.hostname), `${doc.url} is an official documentation host`);
      assert.ok(doc.label.length > 10, doc.url);
    }
  }
});

test("copy is plain: no emoji, hashtags, dashes, urgency, testimonials or invented numbers", () => {
  for (const page of errorPages) {
    for (const text of visibleText(page)) {
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${page.slug} emoji`);
      assert.doesNotMatch(text, /(^|\s)#\w/, `${page.slug} hashtag`);
      assert.doesNotMatch(text, /[–—]/, `${page.slug} dash`);
      assert.doesNotMatch(text, /limited time|act now|hurry|urgent|last chance|don't miss|too late/i, `${page.slug} urgency`);
      assert.doesNotMatch(text, /testimonial|customers say|trusted by|guarantee|\d+\s?%|thousands of|best in class/i, `${page.slug} unsupported claim`);
      assert.doesNotMatch(text, /sk_live_[A-Za-z0-9]|AKIA[0-9A-Z]{8}|ghp_[A-Za-z0-9]|-{5}BEGIN/, `${page.slug} looks like a secret`);
    }
  }
});

test("the scan note says what a scan cannot see, and never claims to run code or fix the error", () => {
  for (const page of errorPages) {
    assert.match(page.scanNote, /\bcannot\b|\bdo not include\b|does not cover/i, `${page.slug} states a limit`);
    assert.doesNotMatch(page.scanNote, /\bfixes\b|\bautomatically\b|\bruns? your (code|build)\b|\bexecutes\b/i, `${page.slug} scan note`);
  }
  // A timeout is a runtime property: the page must not suggest a scan can find it.
  const timeout = errorPageBySlug("vercel-function-invocation-timeout");
  assert.match(timeout?.scanNote ?? "", /cannot measure how long a request takes/);
});

test("steps and sections can be rendered with stable React keys", () => {
  for (const page of errorPages) {
    const headings = page.sections.map((section) => section.heading);
    assert.equal(new Set(headings).size, headings.length, `${page.slug} section headings`);
    for (const section of page.sections) {
      for (const list of [section.body ?? [], section.steps ?? []]) {
        const keys = list.map((item) => item.slice(0, 40));
        assert.equal(new Set(keys).size, keys.length, `${page.slug} ${section.heading} item prefixes`);
      }
    }
  }
});

test("related guides exist, and the other-pages list excludes the page itself", () => {
  for (const page of errorPages) {
    for (const slug of page.relatedGuides) assert.ok(guideBySlug(slug), `${page.slug} links an existing guide: ${slug}`);
    const others = otherErrorPages(page);
    assert.equal(others.length, errorPages.length - 1);
    assert.ok(!others.some((other) => other.slug === page.slug));
  }
  assert.equal(errorPageBySlug("does-not-exist"), undefined);
});

test("the sitemap lists the index and every error page once, and robots does not block /errors", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length, "sitemap urls are unique");
  assert.ok(urls.some((url) => url.endsWith("/errors")));
  for (const page of errorPages) assert.ok(urls.some((url) => url.endsWith(`/errors/${page.slug}`)), page.slug);
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    assert.ok(!disallow.some((path) => "/errors".startsWith(path)), "robots does not disallow /errors");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("the call to action is the existing 24-hour pass checkout and nothing new is added to payments", () => {
  assert.equal(plans.day.usd, "$2");
  assert.equal(plans.day.mode, "payment");
  const page = read("src/app/errors/[slug]/page.tsx");
  assert.match(page, /<ScanCheckoutButton plan="day">/);
  assert.match(page, /plans\.day\.usd/);
  for (const file of ["src/app/errors/[slug]/page.tsx", "src/app/errors/page.tsx", "src/lib/error-pages.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /from "stripe"|@\/lib\/stripe|create-checkout|checkout\.stripe\.com/, `${file} does not touch payments`);
  }
  assert.doesNotMatch(page, /STRIPE_|process\.env/, "the page reads no payment configuration");
  // The index and the guides link to each other, so the pages are reachable without the sitemap.
  assert.match(read("src/app/guides/page.tsx"), /href="\/errors"/);
  assert.match(read("src/app/errors/page.tsx"), /href=\{`\/errors\/\$\{page\.slug\}`\}/);
  assert.match(read("src/app/errors/[slug]/page.tsx"), /canonical: `\/errors\/\$\{page\.slug\}`/);
});
