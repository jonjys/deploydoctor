import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSite, isPublicAddress, LeakCheckError, normalizeSiteUrl, scanText, scriptUrls } from "../src/lib/bundle-leaks";

// Built at runtime so no secret-shaped literal sits in the repository.
const body = (length: number) => Array.from({ length }, (_, index) => "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0"[(index * 7) % 30]).join("");
const stripeLive = ["sk", "live", body(32)].join("_");
const openai = ["sk", "proj", body(48)].join("-");
const jwt = (role: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url"), body(43)].join(".");

test("only public https addresses on named hosts are accepted", () => {
  assert.equal(normalizeSiteUrl("my-app.vercel.app").toString(), "https://my-app.vercel.app/");
  for (const bad of ["http://my-app.com", "https://127.0.0.1", "https://[::1]/", "localhost", "https://intranet.local", "https://my-app.com:8443", "https://user:pw@my-app.com", "javascript:alert(1)"]) {
    assert.throws(() => normalizeSiteUrl(bad), LeakCheckError, bad);
  }
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["76.76.21.21", "2606:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("script URLs: tags, preloads and Next.js chunk paths in inline data, same host only", () => {
  const base = new URL("https://shop.example.com/");
  const html = `<script src="/_next/static/chunks/main-abc.js"></script><link rel="modulepreload" href="/assets/index-1.js">
    <script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/app/page-9f.js\\"]"])</script><script src="https://cdn.other.com/x.js"></script>`;
  assert.deepEqual(scriptUrls(html, base).sort(), ["https://shop.example.com/_next/static/chunks/app/page-9f.js", "https://shop.example.com/_next/static/chunks/main-abc.js", "https://shop.example.com/assets/index-1.js"]);
});

test("secrets are reported masked; public keys are listed as fine", () => {
  const found = scanText(`const a="${stripeLive}";const b="${openai}";const c="${jwt("service_role")}";const d="${jwt("anon")}";const e="pk_live_${body(30)}"`, "/app.js");
  assert.deepEqual(found.leaks.map(leak => leak.kind).sort(), ["openai-key", "stripe-secret", "supabase-service-role"]);
  const serialized = JSON.stringify(found);
  for (const secret of [stripeLive, openai, jwt("service_role")]) assert.ok(!serialized.includes(secret), "no raw secret in the result");
  assert.ok(found.leaks.every(leak => leak.masked.includes("…")));
  assert.deepEqual(found.publicKeys.map(key => key.kind).sort(), ["stripe-publishable", "supabase-anon"]);
  assert.deepEqual(scanText(`const k = "sk-proj-your-key-here-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`, "/a.js").leaks, []);
});

test("a site check reads the page and its scripts, and refuses redirects off https", async () => {
  const pages: Record<string, Response | (() => Response)> = {
    "https://shop.example.com/": () => new Response(`<html><script src="/_next/static/chunks/main.js"></script></html>`, { headers: { "content-type": "text/html" } }),
    "https://shop.example.com/_next/static/chunks/main.js": () => new Response(`var k="${stripeLive}";`),
  };
  const fetcher = async (url: string) => { const page = pages[url]; return typeof page === "function" ? page() : new Response("", { status: 404 }); };
  const resolved: string[] = [];
  const report = await checkSite("shop.example.com", { fetcher, resolve: async host => { resolved.push(host); } });
  assert.equal(report.files, 2);
  assert.equal(report.leaks[0].kind, "stripe-secret");
  assert.equal(report.leaks[0].file, "/_next/static/chunks/main.js");
  assert.ok(resolved.length >= 2, "every request host is checked");

  const redirect = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  await assert.rejects(checkSite("shop.example.com", { fetcher: redirect, resolve: async () => {} }), LeakCheckError);
  const privateHost = async () => { throw new LeakCheckError("That address is not a public website.", 422); };
  await assert.rejects(checkSite("shop.example.com", { fetcher, resolve: privateHost }), /not a public website/);
});

test("the API is same-origin, rate limited and never stores the site", () => {
  const route = readFileSync(new URL("../src/app/api/leak-check/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /acquireWork\(leakCheckRules\(/);
  assert.doesNotMatch(route, /insert|upsert|rpc\(/);
});
