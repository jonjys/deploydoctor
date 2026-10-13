import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { auditMigrations, grantSql, publicTable, stripSql } from "../src/lib/supabase-sql";

const audit = (...sources: string[]) => auditMigrations(sources.map((source, index) => ({ file: `supabase/migrations/2026010${index}_m.sql`, source })));
const byName = (result: ReturnType<typeof audit>) => Object.fromEntries(result.tables.map((table) => [table.name, table]));

test("supabase migrations: a table without RLS or grants is reported with its file and line", () => {
  const result = audit("-- todo app\n\ncreate table public.todos (\n  id bigint primary key,\n  title text\n);\n");
  assert.deepEqual(result.tables, [{ name: "todos", file: "supabase/migrations/20260100_m.sql", line: 3, rls: false, granted: false }]);
});

test("supabase migrations: RLS, a table grant to a Data API role, and a later migration all count", () => {
  const tables = byName(audit(
    "create table if not exists todos (id int);\ncreate table notes (id int);",
    "alter table public.todos enable row level security;\ngrant select, insert on table public.todos to anon, authenticated;\nalter table only notes force row level security;",
  ));
  assert.equal(tables.todos.rls, true);
  assert.equal(tables.todos.granted, true);
  assert.equal(tables.notes.rls, true);
  assert.equal(tables.notes.granted, false);
});

test("supabase migrations: quoted names, other schemas, drop and rename", () => {
  const tables = byName(audit(
    'create table "public"."UserProfiles" (id int);\ncreate table private.secrets (id int);\ncreate table old_name (id int);\ncreate table gone (id int);',
    'alter table "UserProfiles" enable row level security;\nalter table old_name rename to new_name;\ndrop table if exists public.gone cascade;\ngrant all on "UserProfiles" to authenticated;',
  ));
  assert.deepEqual(Object.keys(tables).sort(), ["UserProfiles", "new_name"]);
  assert.equal(tables.UserProfiles.rls, true);
  assert.equal(tables.UserProfiles.granted, true);
  assert.equal(publicTable("private.secrets"), null);
  assert.equal(publicTable("Public.Todos"), "todos");
});

test("supabase migrations: grants on all tables and default privileges", () => {
  const tables = byName(audit(
    "create table a (id int);\ngrant select on all tables in schema public to anon;\ncreate table b (id int);",
    "alter default privileges in schema public grant select on tables to authenticated;\ncreate table c (id int);\nalter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;\ncreate table d (id int);",
  ));
  assert.equal(tables.a.granted, true);
  assert.equal(tables.b.granted, false);
  assert.equal(tables.c.granted, true);
  assert.equal(tables.d.granted, false);
  // A grant to another role, or on a schema or function, is not a table grant for the Data API.
  const other = byName(audit("create table e (id int);\ngrant select on e to reporting;\ngrant usage on schema public to anon;\ngrant execute on function e() to anon;"));
  assert.equal(other.e.granted, false);
});

test("supabase migrations: comments, strings and function bodies are not statements", () => {
  const sql = "/* create table ghost (id int); */\n-- create table ghost2 (id int);\ncreate function f() returns void language sql as $$ create table ghost3 (id int); $$;\nselect 'create table ghost4 (id int);';\ncreate table real_one (id int);";
  assert.deepEqual(audit(sql).tables.map((table) => table.name), ["real_one"]);
  assert.equal(stripSql("a -- b\nc").split("\n").length, 2);
});

test("supabase migrations: policies that let anyone write without a condition", () => {
  const result = audit(
    "create table posts (id int);\nalter table posts enable row level security;\n" +
    'create policy "public read" on posts for select using (true);\n' +
    'create policy "anyone writes" on posts for insert with check (true);\n' +
    "create policy own on posts for update to authenticated using ((select auth.uid()) = user_id);\n" +
    "create policy wide on public.posts to anon using (true);\n" +
    "create policy staff on posts for delete to authenticated using (true);",
  );
  assert.deepEqual(result.openPolicies.map((policy) => [policy.policy, policy.command, policy.line]), [["anyone writes", "insert", 4], ["wide", "all", 6]]);
});

test("supabase check: migrations turn into findings with ready SQL, and no migrations changes nothing", () => {
  const pkg = JSON.stringify({ dependencies: { next: "16.3.6", "@supabase/supabase-js": "2.50.0" } });
  const base: RepositorySnapshot["entries"] = [{ path: "package.json", type: "blob" }, { path: "app/page.tsx", type: "blob" }];
  const run = (files: Record<string, string>) => {
    const entries = [...base, ...Object.keys(files).map((path) => ({ path, type: "blob" as const }))];
    const contents = { "package.json": pkg, "app/page.tsx": "export default function Page() { return null }", ...files };
    return analyzeSnapshot({ owner: "o", name: "r", defaultBranch: "main", entries, contents: new Map(Object.entries(contents)),
      sourceFilesFound: 1, sourceFilesRead: 1, partial: false, partialReasons: [] }, { checks: ["supabase"] }).checks[0];
  };
  assert.equal(run({}).status, "green");

  const red = run({ "supabase/migrations/20260101_init.sql": "create table todos (id int);" });
  assert.equal(red.status, "red");
  assert.equal(red.findings?.length, 2);
  assert.match(red.findings?.[0].problem ?? "", /public\.todos has no row level security/);
  assert.match(red.findings?.[1].fix ?? "", /grant select on table public\.todos to anon;/);
  assert.equal(red.findings?.[1].line, 1);

  const yellow = run({ "supabase/migrations/20260101_init.sql": "create table todos (id int);\nalter table todos enable row level security;" });
  assert.equal(yellow.status, "yellow");
  assert.match(yellow.explanation, /42501/);

  const fine = run({ "supabase/migrations/20260101_init.sql": "create table todos (id int);\nalter table todos enable row level security;\ngrant select on todos to anon;" });
  assert.equal(fine.status, "green");
  assert.equal(grantSql("My Table").split("\n")[0], 'grant select on table public."My Table" to anon;');
});
