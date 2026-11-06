import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkLiveSite, findVatNumber, schemaTypes, legalLinks, robotsFindings, sellsOnline, buildFindings, pathMatches, stripTags, elements } from "../src/lib/site-check";
import { viesCheck } from "../src/lib/vies";
import { handleDeployMcp } from "../src/lib/mcp";
import { LeakCheckError } from "../src/lib/bundle-leaks";

// Built at runtime so no secret-shaped literal sits in the repository.
const body = (length: number) => Array.from({ length }, (_, index) => "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0"[(index * 7) % 30]).join("");
const stripeLive = ["sk", "live", body(32)].join("_");

test("legal links are found by address or text, in English and Swedish", () => {
  assert.deepEqual(legalLinks(`<footer><a href="/policies/privacy-policy">Integritet</a><a href="/pages/kopvillkor">Köpvillkor</a><a href="mailto:hej@butik.se">Mejla oss</a></footer>`),
    { privacy: true, terms: true, returns: false, contact: true });
  assert.equal(legalLinks(`<a href="/refund-policy">Refunds</a>`).returns, true);
  assert.equal(legalLinks(`<p>Write to hello@shop.example</p>`).contact, true);
  assert.deepEqual(legalLinks(`<a href="/about">About</a>`), { privacy: false, terms: false, returns: false, contact: false });
});

test("legal and contact detection ignores look-alikes and finds obfuscated addresses", () => {
  const none = { privacy: false, terms: false, returns: false, contact: false };
  assert.deepEqual(legalLinks(`<a href="/danger-zone">Danger</a><a href="/login?returnTo=/account">Log in</a>`), none);
  assert.deepEqual(legalLinks(`<p>Built with react@18.2.0</p>`), none, "a package version is not an email address");
  assert.equal(legalLinks(`<a href="/cdn-cgi/l/email-protection#abc">[email protected]</a>`).contact, true);
  assert.equal(legalLinks(`<span class="__cf_email__" data-cfemail="abc">[email protected]</span>`).contact, true);
  assert.equal(legalLinks(`<a href="/pages/returer">Retur &amp; byten</a>`).returns, true);
  assert.equal(legalLinks(`<a href="/pages/angerratt">Ångerrätt</a>`).returns, true);
});

test("a shop is recognised by its buy links or a live Stripe publishable key, not by class names", () => {
  assert.equal(sellsOnline(`<a href="/cart">Varukorg</a>`, false), true);
  assert.equal(sellsOnline(`<a href="/products/mug">Mug</a>`, false), true);
  assert.equal(sellsOnline(`<button type="button">Buy now</button>`, false), true);
  assert.equal(sellsOnline(`<a href="/docs">Docs</a>`, false), false);
  assert.equal(sellsOnline(`<a class="border order-1 shopify-like" href="/about">About</a><button class="cart-icon">Menu</button>`, false), false);
  assert.equal(sellsOnline(`<a href="/docs">Docs</a>`, true), true);
});

test("the VAT number is the site's own: labelled, in the footer, never a demo in the body", () => {
  assert.deepEqual(findVatNumber(`<footer>Momsreg.nr: SE 5566 7788 9901</footer>`), { countryCode: "SE", vatNumber: "556677889901" });
  assert.deepEqual(findVatNumber(`<footer>USt-IdNr. DE123456789 Telefon 030</footer>`), { countryCode: "DE", vatNumber: "123456789" });
  assert.deepEqual(findVatNumber(`<footer>VAT GR 094014201</footer>`), { countryCode: "EL", vatNumber: "094014201" });
  assert.equal(findVatNumber(`<main>Try it: VAT SE556036079301</main><footer>© Shop</footer>`), null);
  assert.equal(findVatNumber(`<footer>SKU SE123456789012 in stock</footer>`), null);
  // Without a footer element, only the end of the page counts.
  assert.equal(findVatNumber(`<p>VAT DE123456789</p>${"<p>lorem ipsum</p>".repeat(400)}`), null);
});

test("VAT numbers are never invented from IBANs, longer numbers or words that contain a label", () => {
  assert.equal(findVatNumber(`<footer><a href="/privacy">Privacy</a> IBAN SE45 5000 0000 0583 9825 7466</footer>`), null);
  assert.equal(findVatNumber(`<footer>Customer service · SE45 5000 0000 0583 9825 7466</footer>`), null);
  assert.equal(findVatNumber(`<footer>VAT SE5566778899012345</footer>`), null, "a longer number is not cut down to a valid-looking one");
  assert.deepEqual(findVatNumber(`<footer>USt-IdNr.: DE123456789Telefon</footer>`), { countryCode: "DE", vatNumber: "123456789" });
  assert.deepEqual(findVatNumber(`<footer>VAT IE1234567TW</footer>`), { countryCode: "IE", vatNumber: "1234567TW" });
  assert.deepEqual(findVatNumber(`<footer>UID-Nr: ATU12345678</footer>`), { countryCode: "AT", vatNumber: "U12345678" });
  assert.deepEqual(findVatNumber(`<footer>Shop Srl · P.IVA 01234567890</footer>`), { countryCode: "IT", vatNumber: "01234567890" });
  assert.deepEqual(findVatNumber(`<footer>Moms SE556677889901</footer><div><footer>Cancel</footer></div>`), { countryCode: "SE", vatNumber: "556677889901" }, "a dialog footer after the page footer");
});

test("hostile homepages stay linear: no pattern backtracks on 2 MB of crafted HTML", () => {
  const inputs = ["a".repeat(2_000_000), "<".repeat(2_000_000), "<a href=x>".repeat(200_000), "<footer>".repeat(250_000), "<script>".repeat(250_000), `${"<a>x".repeat(300_000)}`];
  for (const html of inputs) {
    const started = performance.now();
    legalLinks(html); findVatNumber(html); sellsOnline(html, false); schemaTypes(html); stripTags(html.slice(0, 600_000));
    assert.ok(performance.now() - started < 5000, `${html.slice(0, 12)}… took ${Math.round(performance.now() - started)} ms`);
  }
  assert.deepEqual(elements(`<a href="/x">One</a><a>Two`, "a").map(element => element.inner), ["One", ""]);
});

test("robots.txt follows RFC 9309: own groups merged, wildcard fallback, longest rule wins, Allow on a tie", () => {
  const none = { googleBlocked: false, blockedBots: [], trainingOptOut: [] };
  assert.deepEqual(robotsFindings(null), none);
  // Training-only crawlers are an opt-out, not a search block.
  assert.deepEqual(robotsFindings("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /"), { ...none, trainingOptOut: ["GPTBot", "ClaudeBot"] });
  assert.deepEqual(robotsFindings("User-agent: OAI-SearchBot\nDisallow: /x\n\nUser-agent: OAI-SearchBot\nDisallow: /").blockedBots, ["OAI-SearchBot"], "groups for one agent are merged");
  const star = robotsFindings("User-agent: *\nDisallow: /*\n\nUser-agent: PerplexityBot\nAllow: /");
  assert.equal(star.googleBlocked, true, "Disallow: /* blocks like Disallow: /");
  assert.ok(!star.blockedBots.includes("PerplexityBot") && star.blockedBots.includes("OAI-SearchBot"));
  assert.deepEqual(robotsFindings("User-agent: *\nDisallow: /\nAllow: /"), none, "Allow wins a tie");
  assert.equal(robotsFindings("User-agent: *\nAllow: /$\nDisallow: /").googleBlocked, true, "only the homepage open is still a blocked site");
  assert.deepEqual(robotsFindings("User-agent: *\nDisallow: /admin\nDisallow:"), none, "a private folder or an empty Disallow blocks nothing");
});

test("robots path patterns: wildcards, end anchors, and no exponential backtracking", () => {
  assert.equal(pathMatches("/", "/products/x"), true);
  assert.equal(pathMatches("/*.pdf$", "/a/b.pdf"), true);
  assert.equal(pathMatches("/*.pdf$", "/a/b.pdf?x"), false);
  assert.equal(pathMatches("/$", "/"), true);
  assert.equal(pathMatches("/$", "/products"), false);
  const started = performance.now();
  assert.equal(pathMatches(`${"*a".repeat(200)}b`, "/" + "a".repeat(30)), false);
  assert.ok(performance.now() - started < 200);
});

test("structured data: JSON-LD objects, arrays, @graph, unquoted type attributes and microdata", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script>
    <script type=application/ld+json>[{"@type":"Product"}]</script><script type="application/ld+json">{not json</script>
    <div itemscope itemtype="https://schema.org/Offer"></div>`;
  assert.deepEqual(schemaTypes(html).sort(), ["Offer", "Organization", "Product", "Thing", "WebSite"]);
  assert.deepEqual(schemaTypes(`<script>{"@type":"Product"}</script>`), []);
});

test("VIES: a verdict, placeholder names dropped, and a member state outage is unknown, never invalid", async () => {
  const reply = (data: unknown, status = 200) => (async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch;
  assert.deepEqual(await viesCheck({ countryCode: "DE", vatNumber: "123456789" }, reply({ valid: true, name: "---" })), { valid: true, name: null });
  assert.deepEqual(await viesCheck({ countryCode: "SE", vatNumber: "556677889901" }, reply({ valid: false })), { valid: false, name: null });
  assert.equal(await viesCheck({ countryCode: "DE", vatNumber: "1" }, reply({ actionSucceed: false, errorWrappers: [{ error: "MS_UNAVAILABLE" }] })), null);
  assert.equal(await viesCheck({ countryCode: "DE", vatNumber: "1" }, reply({}, 500)), null);
  assert.equal(await viesCheck({ countryCode: "DE", vatNumber: "1" }, (async () => { throw new Error("down"); }) as unknown as typeof fetch), null);
});

type Route = { status?: number; body?: string; location?: string };
function site(routes: Record<string, Route>, requested: string[] = []) {
  return async (url: string) => {
    requested.push(url);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    if (route.location) return new Response(null, { status: route.status ?? 302, headers: { location: route.location } });
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: { "content-type": "text/html" } });
  };
}
const resolve = async () => {};
const home = (inner: string) => `<html><head><title>Shop</title></head><body>${inner}<script src="/_next/static/chunks/main.js"></script></body></html>`;

test("full check: leak, Shopify policy pages found by probing, VAT verified, AI findings, nothing raw", async () => {
  const requested: string[] = [];
  const fetcher = site({
    "https://shop.example.com/": { body: home(`<a href="/cart">Cart</a><footer>Shop AB · VAT SE556677889901</footer>`) },
    "https://shop.example.com/_next/static/chunks/main.js": { body: `var k="${stripeLive}";` },
    "https://shop.example.com/robots.txt": { body: "User-agent: GPTBot\nDisallow: /\n" },
    "https://shop.example.com/policies/privacy-policy": { body: "<h1>Privacy</h1>" },
    "https://shop.example.com/policies/refund-policy": { body: "<h1>Refunds</h1>" },
    "https://shop.example.com/policies/contact-information": { body: "<h1>Contact</h1>" },
    // An unknown path that redirects to the homepage must not count as a terms page.
    "https://shop.example.com/terms": { location: "/" },
  }, requested);
  const vies = async () => ({ valid: true, name: "SHOP AB" });
  const report = await checkLiveSite("shop.example.com", { fetcher, resolve, vies, nonce: "t" });

  assert.equal(report.host, "shop.example.com");
  assert.equal(report.sellsOnline, true);
  assert.deepEqual(report.legal.privacy, { found: true, where: "/policies/privacy-policy" });
  assert.deepEqual(report.legal.terms, { found: false, where: null });
  assert.equal(report.legal.returns.found, true);
  assert.equal(report.legal.contact.found, true);
  assert.deepEqual(report.vat, { countryCode: "SE", vatNumber: "556677889901", verdict: "valid", name: "SHOP AB" });
  assert.deepEqual(report.ai.blockedBots, []);
  assert.deepEqual(report.ai.trainingOptOut, ["GPTBot"]);

  const status = Object.fromEntries(report.findings.map(finding => [finding.id, finding.status]));
  assert.equal(status["leak-stripe-secret"], "fail");
  assert.equal(status["legal-privacy"], "pass");
  assert.equal(status["legal-terms"], "warn");
  assert.equal(status.vat, "pass");
  assert.equal(status["ai-robots"], "pass");
  assert.match(report.findings.find(finding => finding.id === "ai-robots")!.detail, /opt out of AI training \(GPTBot\)/);
  assert.equal(status["ai-schema"], "warn");
  assert.deepEqual(report.summary, { fail: 1, warn: 2, pass: 5 });
  assert.ok(!JSON.stringify(report).includes(stripeLive), "the raw secret never leaves the check");
  assert.ok(requested.every(url => url.startsWith("https://shop.example.com/")), "only the site's own host is fetched");
});

test("a site that answers 200 everywhere is not probed, and missing pages say why", async () => {
  const requested: string[] = [];
  const spa = async (url: string) => { requested.push(url); return new Response(home("<p>app</p>"), { status: 200 }); };
  const report = await checkLiveSite("app.example.com", { fetcher: spa, resolve, vies: async () => { throw new Error("must not be called"); }, nonce: "t" });
  assert.equal(report.legalSearch, "soft-404");
  assert.equal(report.legal.privacy.found, false);
  assert.ok(!requested.some(url => url.endsWith("/policies/privacy-policy")), "no policy probes after a soft 404");
  assert.match(report.findings.find(finding => finding.id === "legal-privacy")!.detail, /answers every address/);
  assert.equal(report.ai.robotsTxt, "missing", "an HTML page served as robots.txt is not a robots.txt");
  assert.equal(report.findings.some(finding => finding.id === "legal-returns"), false, "returns are only asked of a shop");
});

test("an invalid VAT number fails, an unanswered one is only a note", async () => {
  const page = { "https://eu.example.com/": { body: home(`<footer><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> hello@eu.example.com · USt-IdNr. DE123456789</footer>`) } };
  const invalid = await checkLiveSite("eu.example.com", { fetcher: site(page), resolve, vies: async () => ({ valid: false, name: null }), nonce: "t" });
  assert.equal(invalid.findings.find(finding => finding.id === "vat")!.status, "fail");
  const unknown = await checkLiveSite("eu.example.com", { fetcher: site(page), resolve, vies: async () => null, nonce: "t" });
  assert.equal(unknown.vat!.verdict, "unknown");
  assert.equal(unknown.findings.find(finding => finding.id === "vat")!.status, "info");
});

test("probes never leave the host, even through a redirect", async () => {
  const requested: string[] = [];
  const fetcher = site({
    "https://shop.example.com/": { body: home("<p>hi</p>") },
    "https://shop.example.com/privacy": { location: "https://evil.example.net/privacy" },
  }, requested);
  const report = await checkLiveSite("shop.example.com", { fetcher, resolve, vies: async () => null, nonce: "t" });
  assert.equal(report.legal.privacy.found, false);
  assert.ok(!requested.some(url => url.includes("evil.example.net")));
});

test("private and non-https addresses are refused before anything is fetched", async () => {
  await assert.rejects(checkLiveSite("http://shop.example.com"), LeakCheckError);
  await assert.rejects(checkLiveSite("https://127.0.0.1"), LeakCheckError);
});

test("robots findings: Google blocked fails, a robots.txt server error claims nothing, duplicate leaks get their own ids", async () => {
  const leaks = { url: "https://a.example", host: "a.example", files: 1, bytes: 10, partial: false, leaks: [], publicKeys: [] };
  const legal = { privacy: { found: true, where: "homepage" }, terms: { found: true, where: "homepage" }, returns: { found: true, where: "homepage" }, contact: { found: true, where: "homepage" } };
  const base = { url: leaks.url, host: leaks.host, leaks, legal, legalSearch: "complete" as const, sellsOnline: true, vat: null };
  const ai = { robotsTxt: "found" as const, googleBlocked: true, blockedBots: ["OAI-SearchBot"], trainingOptOut: [], schemaTypes: ["Organization"] };
  const google = buildFindings({ ...base, ai });
  assert.equal(google.find(finding => finding.id === "ai-robots")!.status, "fail");
  assert.equal(google.find(finding => finding.id === "leak-none")!.title, "No secret keys in the page", "only the HTML was read");
  const error = buildFindings({ ...base, ai: { ...ai, robotsTxt: "error", googleBlocked: false, blockedBots: [] } });
  assert.equal(error.find(finding => finding.id === "ai-robots")!.status, "info");
  const twice = buildFindings({ ...base, ai, leaks: { ...leaks, leaks: [
    { kind: "openai-key", severity: "critical", file: "/a.js", masked: "sk-proj-…aaaa" }, { kind: "openai-key", severity: "critical", file: "/b.js", masked: "sk-proj-…bbbb" }] } });
  const ids = twice.filter(finding => finding.area === "keys").map(finding => finding.id);
  assert.deepEqual(ids, ["leak-openai-key", "leak-openai-key-2"]);

  const failing = site({ "https://down.example.com/": { body: home("<p>x</p>") }, "https://down.example.com/robots.txt": { status: 503, body: "busy" } });
  const report = await checkLiveSite("down.example.com", { fetcher: failing, resolve, vies: async () => null, nonce: "t" });
  assert.equal(report.ai.robotsTxt, "error");
  const missing = await checkLiveSite("down.example.com", { fetcher: site({ "https://down.example.com/": { body: home("<p>x</p>") } }), resolve, vies: async () => null, nonce: "t" });
  assert.equal(missing.ai.robotsTxt, "missing");
});

test("policy probes stop at the first hit and respect the time budget", async () => {
  const requested: string[] = [];
  const fetcher = site({ "https://s.example.com/": { body: home("<p>x</p>") }, "https://s.example.com/policies/privacy-policy": { body: "ok" } }, requested);
  await checkLiveSite("s.example.com", { fetcher, resolve, vies: async () => null, nonce: "t" });
  assert.ok(!requested.includes("https://s.example.com/privacy"), "no further privacy addresses after a hit");
  // Every probe hangs until it is aborted; only the shared deadline can end them.
  const slow = async (url: string, init: RequestInit) => {
    if (url === "https://slow.example.com/") return new Response("<html><title>x</title><p>x</p></html>");
    return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  };
  // AbortSignal.timeout does not keep Node alive on its own; a server request does, so the test holds a timer.
  const keepAlive = setTimeout(() => {}, 10_000);
  const started = performance.now();
  const report = await checkLiveSite("slow.example.com", { fetcher: slow, resolve, vies: async () => null, nonce: "t", probeBudgetMs: 300 });
  clearTimeout(keepAlive);
  assert.ok(performance.now() - started < 3000);
  assert.equal(report.ai.robotsTxt, "error");
  assert.equal(report.legalSearch, "timed-out");
  assert.match(report.findings.find(finding => finding.id === "legal-privacy")!.detail, /too slow/);
});

test("the API is same-origin, rate limited and never stores the site", () => {
  const route = readFileSync(new URL("../src/app/api/site-check/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /acquireWork\(siteCheckRules\(/);
  assert.match(route, /maxDuration = 60/);
  assert.doesNotMatch(route, /insert|upsert|rpc\(/);
});

test("MCP check_live_site goes through the rate-limited API with the trusted IP and no cookies", async () => {
  const base = "https://deploydoctor.nyttolabs.com";
  const fail = async () => { throw new Error("must-not-be-called"); };
  let seen: Request | null = null;
  const backend = { scan: fail, report: fail, siteCheck: async (request: Request) => {
    seen = request;
    return Response.json({ host: "shop.example.com", url: "https://shop.example.com", summary: { fail: 0, warn: 1, pass: 4 },
      findings: [{ id: "ai-jsonld", area: "ai", status: "warn", title: "No structured data", detail: "x", fix: "y" }] });
  } };
  const response = await handleDeployMcp(new Request(`${base}/api/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-vercel-forwarded-for": "192.0.2.1", cookie: "session=secret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_live_site", arguments: { url: "shop.example.com" } } }),
  }), backend, base);
  const data = await response.json() as { result: { structuredContent: Record<string, unknown>; isError: boolean } };
  assert.equal(data.result.isError, false);
  assert.deepEqual(data.result.structuredContent.summary, { fail: 0, warn: 1, pass: 4 });
  const request = seen as unknown as Request;
  assert.equal(request.url, `${base}/api/site-check`);
  assert.equal(request.headers.get("origin"), base);
  assert.equal(request.headers.get("x-vercel-forwarded-for"), "192.0.2.1");
  assert.equal(request.headers.get("cookie"), null);
  assert.deepEqual(await request.json(), { url: "shop.example.com" });
});
