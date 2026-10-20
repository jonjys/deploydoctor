import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { communityInput, reviewRules } from "../src/lib/community-review";

const review = { kind: "review", name: "Alex", body: "Useful, but missed my build issue.", rating: 2, consent: true, website: "" };
test("reviews require real star values, explicit consent and bounded text; ideas stay private", () => {
  assert.equal(communityInput.safeParse(review).success, true);
  for (const change of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: "5" }, { consent: false }, { name: " " }, { body: "short" }, { body: "a".repeat(1501) }, { body: "Text with \u0000 control" }, { website: "https://spam.test" }, { status: "published" }]) {
    assert.equal(communityInput.safeParse({ ...review, ...change }).success, false);
  }
  assert.equal(communityInput.safeParse({ ...review, kind: "idea", consent: false, rating: null }).success, true);
  assert.equal(communityInput.safeParse({ ...review, kind: "idea" }).success, false);
  assert.equal(reviewRules("visitor")[0].limit, 3);
});

test("SQL protects private feedback, includes low ratings, counts all public reviews and limits cards", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(readFileSync(new URL("../supabase/migrations/20261020160027_community_reviews.sql", import.meta.url), "utf8"));
    const insert = (hash: string, kind: string, rating: number | null, consent: boolean, status: string) => db.query("insert into community_reviews(voter_hash,kind,name,body,rating,consent,status) values($1,$2,'Alias','Some feedback here',$3,$4,$5)", [hash.padEnd(64, "0"), kind, rating, consent, status]);
    await insert("pending", "review", 5, true, "pending");
    await insert("idea", "idea", null, false, "pending");
    await insert("rejected", "review", 5, true, "rejected");
    for (let i = 0; i < 8; i++) await insert(String(i), "review", i % 2 ? 5 : 1, true, "published");
    await assert.rejects(() => insert("no-consent", "review", 3, false, "published"));
    await assert.rejects(() => insert("public-idea", "idea", null, false, "published"));
    const data = (await db.query<{ result: { count: number; average: number; reviews: Record<string, unknown>[] } }>("select community_review_summary() as result")).rows[0].result;
    assert.equal(data.count, 8); assert.equal(data.average, 3); assert.equal(data.reviews.length, 6);
    assert.deepEqual(Object.keys(data.reviews[0]).sort(), ["body", "created_at", "id", "name", "rating"]);
    await db.exec("set role anon;");
    await assert.rejects(() => db.query("select * from community_reviews"));
    await assert.rejects(() => db.query("select community_review_summary()"));
    await assert.rejects(() => db.query("insert into community_reviews default values"));
    await db.exec("reset role; set role authenticated;");
    await assert.rejects(() => db.query("select community_review_summary()"));
    await db.exec("reset role; set role service_role;");
    assert.equal((await db.query("select community_review_summary() as result")).rows.length, 1);
    await db.query("update community_reviews set status='pending',rating=2 where voter_hash=$1", ["0".padEnd(64, "0")]);
    const after = (await db.query<{ result: { count: number } }>("select community_review_summary() as result")).rows[0].result;
    assert.equal(after.count, 7);
  } finally { await db.close(); }
});

test("API rejects bad origin, spam, oversized input and quotas; updates cannot self-publish", async () => {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = { exports: {}, loaded: true } as NodeModule;
  let owner: string | undefined;
  require.cache[require.resolve("next/headers")] = { exports: { cookies: async () => ({ get: () => owner ? { value: owner } : undefined, set: (_name: string, value: string) => { owner = value; } }) }, loaded: true } as NodeModule;
  const { POST } = await import("../src/app/api/reviews/route");
  const previousFetch = globalThis.fetch;
  const previousEnv = { SESSION_SECRET: process.env.SESSION_SECRET, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY, VERCEL: process.env.VERCEL };
  Object.assign(process.env, { SESSION_SECRET: "review-fixture-secret-long-enough-for-testing", NEXT_PUBLIC_SUPABASE_URL: "https://db.fixture", SUPABASE_SECRET_KEY: "fixture" }); delete process.env.VERCEL;
  const records: Record<string, unknown>[] = [];
  let limited = false, fail = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("acquire_work_budget")) return Response.json({ allowed: !limited, retryAfter: 600 });
    if (fail) return new Response(null, { status: 500 });
    records.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
  };
  const request = (body: unknown, origin = "https://fixture.test") => new Request("https://fixture.test/api/reviews", { method: "POST", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  try {
    assert.equal((await POST(request(review, "https://evil.test"))).status, 403);
    assert.equal((await POST(request({ ...review, status: "published" }))).status, 400);
    assert.equal((await POST(request({ ...review, website: "spam" }))).status, 400);
    assert.equal((await POST(request("x".repeat(8001)))).status, 413);
    assert.equal((await POST(request("{"))).status, 400);
    assert.equal(records.length, 0);
    assert.equal((await POST(request(review))).status, 201);
    assert.equal(records[0].status, "pending"); assert.equal(records[0].rating, 2);
    assert.match(String(records[0].voter_hash), /^[a-f0-9]{64}$/);
    assert.notEqual(records[0].voter_hash, owner);
    assert.equal((await POST(request({ ...review, rating: 1 }))).status, 201);
    assert.equal(records[1].voter_hash, records[0].voter_hash); assert.equal(records[1].status, "pending");
    limited = true;
    const blocked = await POST(request(review)); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("Retry-After"), "600"); assert.equal(records.length, 2);
    limited = false; fail = true;
    assert.equal((await POST(request(review))).status, 503);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
