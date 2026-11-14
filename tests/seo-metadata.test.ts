import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sitemap from "../src/app/sitemap";
import { messages } from "../src/lib/i18n";
import {
  CANONICAL_ORIGIN, SHARE_IMAGE, canonicalUrl, documentTitle, notFoundMeta, pageMetadata, pages, partnerMeta, scoreDescription, statsMeta,
} from "../src/lib/seo";
import { EXAMPLE_REPORTS, SITE_URL } from "../src/lib/site";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function expectLength(label: string, value: string, min: number, max: number) {
  assert.ok(value.length >= min && value.length <= max, `${label} is ${value.length} characters: ${value}`);
}

test("marketing titles and descriptions stay in the search-result range and do not repeat", () => {
  const titles: string[] = [];
  const descriptions: string[] = [];
  const remember = (label: string, title: string, description: string) => {
    expectLength(`${label} title`, title, 50, 60);
    expectLength(`${label} description`, description, 150, 160);
    titles.push(title);
    descriptions.push(description);
  };
  for (const [name, page] of Object.entries(pages)) remember(name, page.title, page.description);
  for (const lang of ["en", "sv"] as const) {
    remember(`partner ${lang}`, partnerMeta[lang].title, partnerMeta[lang].description);
    remember(`stats ${lang}`, statsMeta[lang].title, statsMeta[lang].description);
    remember(`not found ${lang}`, notFoundMeta[lang].title, notFoundMeta[lang].description);
    remember("home", messages[lang]["meta.title"], messages[lang]["meta.desc"]);
    remember("pricing", messages[lang]["pricing.title"], messages[lang]["pricing.meta"]);
    remember("diagnose", messages[lang]["diag.title"], messages[lang]["diag.meta"]);
    remember("fix", messages[lang]["fix.title"], messages[lang]["fix.meta"]);
    remember("rescue", messages[lang]["fix.wallSeoTitle"], messages[lang]["fix.wallMeta"]);
  }
  expectLength("score description", scoreDescription, 150, 160);
  for (const n of ["2", "12"]) {
    expectLength(`report en ${n}`, messages.en["report.metaDesc"].replaceAll("{n}", n), 150, 160);
    expectLength(`report sv ${n}`, messages.sv["report.metaDesc"].replaceAll("{n}", n), 150, 160);
    descriptions.push(messages.en["report.metaDesc"].replaceAll("{n}", n));
    descriptions.push(messages.sv["report.metaDesc"].replaceAll("{n}", n));
  }
  assert.equal(new Set(titles).size, titles.length, "titles are unique");
  assert.equal(new Set(descriptions).size, descriptions.length, "descriptions are unique");
});

test("canonicals and the shared card point at the production host", () => {
  assert.equal(CANONICAL_ORIGIN, "https://deploydoctor.nyttolabs.com");
  assert.equal(canonicalUrl("/"), `${CANONICAL_ORIGIN}/`);
  assert.equal(canonicalUrl("/pricing"), `${CANONICAL_ORIGIN}/pricing`);
  const meta = pageMetadata(pages.safe);
  assert.equal(meta.alternates && "canonical" in meta.alternates ? meta.alternates.canonical : "", `${CANONICAL_ORIGIN}/safe`);
  const images = meta.openGraph && "images" in meta.openGraph ? meta.openGraph.images : undefined;
  const first = Array.isArray(images) ? images[0] : images;
  assert.equal(first && typeof first === "object" && "url" in first ? first.url : "", SHARE_IMAGE.url);
  const report = pageMetadata({ title: "Report", description: "A saved report.", path: "/r/example", image: null });
  assert.equal(Boolean(report.openGraph && "images" in report.openGraph), false);
  assert.equal(documentTitle("Short title"), "Short title | DeployDoctor");
  assert.equal(documentTitle("A title that is already long enough to stand without the brand suffix"), "A title that is already long enough to stand without the brand suffix");
});

test("the sitemap lists public pages and the sample reports, and skips private routes", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const page of Object.values(pages)) assert.ok(urls.includes(`${CANONICAL_ORIGIN}${page.path}`), page.path);
  assert.ok(urls.includes(CANONICAL_ORIGIN));
  assert.ok(urls.includes(`${CANONICAL_ORIGIN}/pricing`));
  assert.ok(urls.includes(`${CANONICAL_ORIGIN}/partners`));
  assert.ok(urls.includes(`${CANONICAL_ORIGIN}/diagnose`));
  assert.ok(urls.includes(`${CANONICAL_ORIGIN}/fix`));
  assert.ok(urls.includes(`${CANONICAL_ORIGIN}/rescue`));
  const examples = EXAMPLE_REPORTS.map((item) => `${SITE_URL}/r/${item.id}`);
  for (const url of examples) assert.ok(urls.includes(url), url);
  for (const url of urls) {
    assert.equal(url.startsWith(`${CANONICAL_ORIGIN}/`) || url === CANONICAL_ORIGIN, true, url);
    assert.equal(/\/(api|account|checkout|growth|watch|restore|patch)(\/|$)/.test(new URL(url).pathname), false, url);
    if (url.includes("/r/")) assert.ok(examples.includes(url), url);
  }
});

test("the homepage graph names the organization, the website and the app, and invents no ratings", () => {
  const home = read("src/app/page.tsx");
  const layout = read("src/app/layout.tsx");
  assert.match(home, /"@type": "Organization"/);
  assert.match(home, /"@type": "WebSite"/);
  assert.match(home, /"@type": "SoftwareApplication"/);
  assert.doesNotMatch(home, /aggregateRating|reviewCount|ratingValue/);
  assert.match(layout, /metadataBase: new URL\(CANONICAL_ORIGIN\)/);
  assert.match(read("src/app/robots.ts"), /CANONICAL_ORIGIN/);
});
