import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("database budgets enforce atomic limits, cooldowns, lease release and service-role isolation", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(readFileSync("supabase/migrations/20261019174835_launch_guardrails.sql", "utf8"));
    const key = "a".repeat(64);
    const rules = JSON.stringify([{ key, limit: 2, seconds: 86400 }]);
    const acquire = async (r = rules, lease: string | null = null) => {
      const result = await db.query<{ result: { allowed: boolean; retryAfter: number; lease: string } }>(
        "select public.acquire_work_budget($1::jsonb,$2::text,1,90) as result", [r, lease]);
      return result.rows[0].result;
    };
    const results = await Promise.all([acquire(), acquire(), acquire()]);
    assert.deepEqual(results.map(item => item.allowed), [true, true, false]);
    assert.ok(results[2].retryAfter > 0);
    const first = await acquire("[]", "b".repeat(64));
    assert.equal(first.allowed, true);
    assert.equal((await acquire("[]", "b".repeat(64))).allowed, false);
    await db.query("select public.release_work_budget($1::uuid)", [first.lease]);
    assert.equal((await acquire("[]", "b".repeat(64))).allowed, true);
    await db.exec("update public.work_budget_leases set expires_at = now() - interval '1 second'");
    assert.equal((await acquire("[]", "b".repeat(64))).allowed, true);
    const privileges = await db.query<{ anon_read: boolean; anon_execute: boolean; server_execute: boolean }>(`select
      has_table_privilege('anon','public.work_budget_buckets','SELECT') as anon_read,
      has_function_privilege('anon','public.acquire_work_budget(jsonb,text,integer,integer)','EXECUTE') as anon_execute,
      has_function_privilege('service_role','public.acquire_work_budget(jsonb,text,integer,integer)','EXECUTE') as server_execute`);
    assert.deepEqual(privileges.rows[0], { anon_read: false, anon_execute: false, server_execute: true });
    await db.exec("set role service_role");
    assert.equal((await acquire("[]", "c".repeat(64))).allowed, true);
  } finally { await db.close(); }
});
