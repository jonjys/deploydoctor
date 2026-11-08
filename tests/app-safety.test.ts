import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAppSafety, headerFindings, ownerToken, rowCount, supabaseFromTexts } from "../src/lib/app-safety";

const SECRET = "test-secret-test-secret-test-secret-42";
const REF = "abcdefghijklmnopqrst";
// Key-shaped values are built at runtime so no secret-like literal sits in the repository.
const jwt = (role: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ iss: "supabase", ref: REF, role })).toString("base64url"), "sIgNaTuRe".repeat(5)].join(".");
const ANON = jwt("anon");

type Call = { url: string; method: string };
function site(options: { verified?: "file" | "meta" | false; envFile?: boolean; headers?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const token = ownerToken("shop.example.com", SECRET);
  const html = `<html><head>${options.verified === "meta" ? `<meta name="deploydoctor-verify" content="${token}">` : ""}</head><body><script src="/assets/index.js"></script></body></html>`;
  const js = `const s=createClient("https://${REF}.supabase.co","${ANON}");s.from("profiles").select();s.from('orders').select();\n//# sourceMappingURL=index.js.map`;
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method });
    const ok = (body: string, headers: Record<string, string> = {}) => new Response(method === "HEAD" ? null : body, { status: 200, headers });
    const u = new URL(url);
    if (u.hostname === `${REF}.supabase.co`) {
      if (u.pathname === "/rest/v1/") return new Response(JSON.stringify({ paths: { "/": {}, "/profiles": {}, "/orders": {}, "/notes": {} } }), { status: 200 });
      if (u.pathname === "/rest/v1/profiles") return new Response(null, { status: 206, headers: { "content-range": "0-0/2341" } });
      if (u.pathname === "/rest/v1/orders") return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      return new Response(null, { status: 401 });
    }
    if (u.pathname === "/") return ok(html, { "content-type": "text/html", ...(options.headers ?? {}) });
    if (u.pathname === "/assets/index.js") return ok(js);
    if (u.pathname === "/assets/index.js.map") return ok('{"version":3,"sources":[]}');
    if (u.pathname === "/.well-known/deploydoctor.txt" && options.verified === "file") return ok(`${token}\n`);
    if (u.pathname === "/.env" && options.envFile) return ok("DATABASE_URL=postgres://x\nSTRIPE_SECRET_KEY=abc\n");
    // A soft-404 site answers every path with its HTML shell.
    return ok("<!doctype html><html><body>Not found</body></html>", { "content-type": "text/html" });
  };
  return { calls, fetcher, resolve: async () => {} };
}

test("the owner token is bound to the host and stable", () => {
  assert.equal(ownerToken("Shop.Example.com", SECRET), ownerToken("shop.example.com", SECRET));
  assert.notEqual(ownerToken("shop.example.com", SECRET), ownerToken("evil.example.com", SECRET));
  assert.match(ownerToken("shop.example.com", SECRET), /^dd-verify-[0-9a-f]{32}$/);
});

test("the Supabase project, its public key and table names come from the site's JavaScript", () => {
  const found = supabaseFromTexts([{ body: `x("https://${REF}.supabase.co","${ANON}");db.from("profiles");db.from( 'orders' )` }])!;
  assert.equal(found.host, `${REF}.supabase.co`);
  assert.equal(found.key, ANON);
  assert.deepEqual(found.tables, ["profiles", "orders"]);
  assert.equal(supabaseFromTexts([{ body: `x("https://${REF}.supabase.co","${jwt("service_role")}")` }]), null, "a service_role key is never used as the probe key");
  assert.equal(rowCount("0-0/2341"), 2341);
  assert.equal(rowCount("*/0"), 0);
  assert.equal(rowCount(null), null);
});

test("without verification only the public checks run: no database request and no .env request", async () => {
  const { calls, fetcher, resolve } = site({ verified: false, headers: { "strict-transport-security": "max-age=63072000" } });
  const report = await checkAppSafety("shop.example.com", { fetcher, resolve, secret: SECRET });
  assert.equal(report.owner.verified, false);
  assert.equal(report.verdict, "public-checks-passed");
  assert.equal(report.supabase, `${REF}.supabase.co`);
  assert.ok(!calls.some(call => call.url.includes("supabase.co")), "the database is not touched");
  assert.ok(!calls.some(call => /\/\.env|\/\.git/.test(call.url)), "no source file is requested");
  assert.ok(report.findings.some(f => f.id === "db-unverified"));
  assert.ok(report.findings.some(f => f.id === "sourcemaps" && f.status === "warn"));
  assert.ok(!JSON.stringify(report).includes(ANON), "the public key is used, never returned");
});

test("a verified owner gets the database and file checks: row counts by HEAD, never rows", async () => {
  for (const verified of ["file", "meta"] as const) {
    const { calls, fetcher, resolve } = site({ verified, envFile: true });
    const report = await checkAppSafety("shop.example.com", { fetcher, resolve, secret: SECRET });
    assert.equal(report.owner.verified, true, verified);
    assert.equal(report.verdict, "not-safe");
    assert.deepEqual(report.exposedTables, [{ table: "profiles", rows: 2341 }]);
    const tableCalls = calls.filter(call => /supabase\.co\/rest\/v1\/[a-z]/.test(call.url));
    assert.ok(tableCalls.length >= 3 && tableCalls.every(call => call.method === "HEAD"), "tables are only counted");
    assert.ok(report.findings.some(f => f.id === "file-/.env" && f.status === "fail"));
    assert.ok(!report.findings.some(f => f.id === "file-/.git/config"), "a soft-404 HTML page is not a git file");
    assert.ok(!JSON.stringify(report).includes(ANON));
    assert.ok(!JSON.stringify(report).includes("postgres://"), "file contents are never returned");
  }
});

test("browser protection headers", () => {
  const good = headerFindings(new Headers({ "strict-transport-security": "max-age=1", "content-security-policy": "default-src 'self'; frame-ancestors 'none'", "x-content-type-options": "nosniff" }));
  assert.ok(good.every(f => f.status === "pass"));
  const bare = headerFindings(new Headers());
  assert.deepEqual(bare.map(f => f.status), ["warn", "warn", "warn", "info"]);
});

test("the API is same-origin, rate limited and stores nothing", () => {
  const route = readFileSync(new URL("../src/app/api/safe/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /acquireWork\(appSafetyRules\(/);
  assert.doesNotMatch(route, /insert|upsert|rpc\(/);
});
