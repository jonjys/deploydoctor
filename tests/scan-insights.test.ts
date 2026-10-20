import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { insightLabel, insightPercent } from "../src/lib/scan-insights";

test("public insights deduplicate repos, exclude ignored/partial/demo/private data and never expose source", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.reports(id uuid default gen_random_uuid(),repo_url text,results jsonb,created_at timestamptz default now()); create table public.private_reports (like public.reports);");
    await db.exec(readFileSync(new URL("../supabase/migrations/20261020160514_public_scan_insights.sql", import.meta.url), "utf8"));
    const get = async () => (await db.query<{ result: { scans: number; repositories: number; categories: { id: string; red: number; yellow: number; checked: number }[]; activity: { at: string }[]; days: { day: string; count: number }[] } }>("select public.public_scan_insights() as result")).rows[0].result;
    assert.deepEqual((await get()).categories, []); assert.equal((await get()).scans, 0);
    const insert = async (repo: string, checks: unknown[], { ago = "1 hour", partial = false, ignored = [] as string[], id = crypto.randomUUID(), table = "reports" } = {}) => {
      await db.query(`insert into public.${table}(id,repo_url,results,created_at) values($1,$2,$3,now() - $4::interval)`, [id, repo, JSON.stringify({ scan: { partial }, checks, scope: { ignored }, repository: { name: "SECRET-NAME" } }), ago]);
    };
    const check = (id: string, status: string, category = "next") => ({ id, status, category, title: "SECRET-TITLE", findings: [{ file: "SECRET-PATH" }] });
    await insert("https://github.com/Owner/Repo", [check("imports", "red")], { ago: "4 hours" });
    await insert("https://github.com/owner/repo", [check("imports", "green"), check("env", "red", "env")], { ago: "2 hours", ignored: ["env"] });
    await insert("https://github.com/example/two", [check("imports", "yellow"), check("env", "red", "env")]);
    await insert("https://github.com/example/three", [check("imports", "red")], { ago: "2 days" });
    await insert("https://github.com/example/partial", [check("imports", "red")], { partial: true });
    await insert("https://github.com/example/old", [check("imports", "red")], { ago: "31 days" });
    await insert("https://github.com/example/demo", [check("imports", "red")], { id: "4e515536-d2b3-474f-884e-b4498baa878f" });
    await insert("https://github.com/SECRET-PRIVATE/REPO", [check("imports", "red")], { table: "private_reports" });
    const data = await get();
    assert.equal(data.scans, 4); assert.equal(data.repositories, 3);
    assert.deepEqual(data.categories.find(c => c.id === "imports"), { id: "imports", red: 1, yellow: 1, checked: 3 });
    assert.deepEqual(data.categories.find(c => c.id === "env"), { id: "env", red: 1, yellow: 0, checked: 1 });
    assert.equal(data.activity.length, 3); assert.ok(data.activity.every(item => new Date(item.at).getUTCMinutes() === 0));
    const json = JSON.stringify(data); for (const secret of ["SECRET-", "github.com", "repo_url", "findings", "Owner"]) assert.equal(json.includes(secret), false);
    assert.equal(data.days.reduce((sum, day) => sum + day.count, 0), 4);
    await db.exec("set role anon;"); await assert.rejects(() => db.query("select public.public_scan_insights()"));
    await db.exec("reset role; set role authenticated;"); await assert.rejects(() => db.query("select public.public_scan_insights()"));
  } finally { await db.close(); }
});

test("stats labels and proportions use per-check denominators and safe zero handling", () => {
  assert.equal(insightPercent(1, 3), 33); assert.equal(insightPercent(0, 0), 0);
  assert.equal(insightLabel("imports", "sv"), "Importsökvägar"); assert.equal(insightLabel("imports", "en"), "Import paths");
  const ticker = readFileSync(new URL("../src/components/scan-activity.tsx", import.meta.url), "utf8");
  assert.match(ticker, /visibilityState !== "visible"/); assert.match(ticker, /clearInterval/); assert.match(ticker, /controller.abort/); assert.match(ticker, /60_000/);
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /animation-play-state: paused/);
});
