/** Run against a production build: node --import tsx scripts/check-seo.ts [origin]. */
import assert from "node:assert/strict";
import { activeErrorPages } from "../src/lib/error-pages";
import { guides } from "../src/lib/guides";
import { consolidatedErrors } from "../src/lib/seo-routes";
import { SITE_URL } from "../src/lib/site";
const origin = process.argv[2] || "http://localhost:3333";
const decode = (s: string) => s.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
function meta(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/g) || [];
  const matching = tags.filter((tag) => tag.includes(`name="${key}"`) || tag.includes(`property="${key}"`));
  assert.equal(matching.length,1,`${key}: exactly one tag`);
  return decode(matching[0].match(/content="([^"]*)"/)![1]);
}
function canonical(html: string) {
  const tags = (html.match(/<link\b[^>]*>/g) || []).filter((tag) => tag.includes('rel="canonical"'));
  assert.equal(tags.length,1,"exactly one canonical");
  return decode(tags[0].match(/href="([^"]*)"/)![1]);
}
async function main() {
  const home = await fetch(origin+"/", {headers:{"user-agent":"Twitterbot/1.0"}});
  assert.equal(home.status,200); assert.doesNotMatch(home.headers.get("x-robots-tag") || "", /noindex/i); const html = await home.text();
  assert.doesNotMatch(meta(html,"robots"), /noindex/i);
  assert.equal(new URL(canonical(html)).href,SITE_URL+"/");
  assert.match(meta(html,"twitter:title"),/Vercel deploy failed/);
  assert.doesNotMatch(meta(html,"twitter:title"),/preflight/i);
  const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
  assert.doesNotMatch(schema,/EU rules|VAT number|AI search/);
  for (const [slug, target] of Object.entries(consolidatedErrors)) {
    const r=await fetch(origin+`/errors/${slug}?source=share`, {redirect:"manual"});
    assert.equal(r.status,308,slug);
    assert.equal(new URL(r.headers.get("location")!,origin).pathname,`/guides/${target}`);
    assert.equal(new URL(r.headers.get("location")!,origin).search,"?source=share");
  }
  const pages=[...activeErrorPages.map(p=>({...p,path:`/errors/${p.slug}`})),...guides.map(p=>({...p,path:`/guides/${p.slug}`}))];
  for(const page of pages) {
    const r=await fetch(origin+page.path,{headers:{"user-agent":"Twitterbot/1.0"}});assert.equal(r.status,200,page.path);
    const html=await r.text(); assert.doesNotMatch(meta(html,"robots"), /noindex/i, page.path); assert.equal(canonical(html),SITE_URL+page.path,page.path);
    assert.equal(meta(html,"twitter:title"),page.title,page.path);
    assert.equal(meta(html,"twitter:description"),page.description,page.path);
    assert.equal(meta(html,"og:title"),page.title,page.path);
    assert.equal(meta(html,"og:url"),SITE_URL+page.path,page.path);
    assert.match(meta(html,"twitter:image"),/\/og\.png$/);
  }
  for(const slug of ["constructor","unknown-error"]) assert.equal((await fetch(origin+`/errors/${slug}`,{redirect:"manual"})).status,404);
  const xml=await (await fetch(origin+"/sitemap.xml")).text();
  for(const slug of Object.keys(consolidatedErrors)) assert.ok(!xml.includes(`${SITE_URL}/errors/${slug}<`),slug);
  for(const page of pages) assert.ok(xml.includes(SITE_URL+page.path),page.path);
  console.log(`PASS: homepage, 5 permanent redirects, ${pages.length} canonical/social previews, sitemap and 404s`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
