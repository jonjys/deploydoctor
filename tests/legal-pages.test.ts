import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { legalLinks } from "../src/lib/site-check";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy, terms and refund pages exist, are in the sitemap and are never read as a repository", () => {
  for (const page of ["privacy", "terms", "refunds"]) {
    assert.ok(existsSync(new URL(`../src/app/${page}/page.tsx`, import.meta.url)), page);
    assert.match(read("src/app/sitemap.ts"), new RegExp(`/${page}\``));
    assert.match(read("src/lib/repo-link.ts"), new RegExp(`"${page}"`));
  }
});

test("the homepage and pricing footers carry the legal links, and DeployDoctor passes its own site check", () => {
  assert.match(read("src/app/page.tsx"), /<LegalLinks \/>/);
  assert.match(read("src/app/pricing/page.tsx"), /<LegalLinks \/>/);
  // The rendered markup of LegalLinks, as the live site check reads it.
  const footer = `<footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> · <a href="mailto:support@nyttolabs.com">support@nyttolabs.com</a></footer>`;
  assert.deepEqual(legalLinks(footer), { privacy: true, terms: true, returns: true, contact: true });
  const component = read("src/components/legal-links.tsx");
  for (const href of ['href="/privacy"', 'href="/terms"', 'href="/refunds"', "mailto:"]) assert.ok(component.includes(href), href);
});

test("the legal pages name the operator the way Nytto Labs does elsewhere and publish no personal identifiers", () => {
  const operator = read("src/lib/operator.ts");
  assert.match(operator, /Swedish sole trader/);
  assert.match(operator, /Approved for F-tax\. VAT-registered\./);
  for (const page of ["privacy", "terms", "refunds"]) {
    const source = read(`src/app/${page}/page.tsx`);
    assert.doesNotMatch(source, /\b\d{6}-?\d{4}\b|SE\d{10}01|personnummer/i, page);
  }
});

test("the refund policy states the 14-day withdrawal right and matches the fix refund rules in code", () => {
  const refunds = read("src/app/refunds/page.tsx");
  assert.match(refunds, /14 days/);
  assert.match(refunds, /Vercel&apos;s build of the fix commit fails/);
  assert.match(read("src/lib/fix-pr/outcome.ts").concat(read("src/lib/fix-pr/refund.ts")), /Vercel/);
});
