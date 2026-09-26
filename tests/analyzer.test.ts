import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";

function snapshot(
  entries: RepositorySnapshot["entries"],
  contents: Record<string, string>,
): RepositorySnapshot {
  const sourceFilesFound = entries.filter(
    (entry) => entry.type === "blob" && /\.[jt]sx?$/.test(entry.path),
  ).length;
  return {
    owner: "example",
    name: "repo",
    defaultBranch: "main",
    entries,
    contents: new Map(Object.entries(contents)),
    sourceFilesFound,
    sourceFilesRead: Object.keys(contents).filter((file) => /\.[jt]sx?$/.test(file)).length,
    partial: false,
  };
}

test("acceptance repository fails checks 1 and 3", () => {
  const packageJson = JSON.stringify({
    dependencies: { next: "16.3.6", playwright: "^1.63.0" },
  });
  const results = analyzeSnapshot(
    snapshot(
      [{ path: "package.json", type: "blob" }],
      { "package.json": packageJson },
    ),
  );

  assert.equal(results.checks[0].id, "next-entry");
  assert.equal(results.checks[0].status, "red");
  assert.equal(results.checks[2].id, "server-libs");
  assert.equal(results.checks[2].status, "red");
});

test("missing relative and alias imports are reported", () => {
  const results = analyzeSnapshot(
    snapshot(
      [
        { path: "package.json", type: "blob" },
        { path: "src", type: "tree" },
        { path: "src/app", type: "tree" },
        { path: "src/app/page.tsx", type: "blob" },
      ],
      {
        "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
        "src/app/page.tsx":
          'import Widget from "@/components/widget"; import { thing } from "./missing"; export default function Page(){ return <Widget /> }',
      },
    ),
  );

  const imports = results.checks.find((check) => check.id === "imports");
  assert.equal(imports?.status, "red");
  assert.equal(imports?.evidence.length, 2);
});

test("generated Next.js type imports are not treated as missing", () => {
  const results = analyzeSnapshot(
    snapshot(
      [
        { path: "package.json", type: "blob" },
        { path: "app", type: "tree" },
        { path: "app/page.tsx", type: "blob" },
        { path: "next-env.d.ts", type: "blob" },
      ],
      {
        "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
        "app/page.tsx": "export default function Page() { return null }",
        "next-env.d.ts": 'import "./.next/types/routes.d.ts";',
      },
    ),
  );

  assert.equal(results.checks.find((check) => check.id === "imports")?.status, "green");
});

test("environment and Supabase client boundary violations are reported", () => {
  const results = analyzeSnapshot(
    snapshot(
      [
        { path: "package.json", type: "blob" },
        { path: "app", type: "tree" },
        { path: "app/api", type: "tree" },
        { path: "app/api/data", type: "tree" },
        { path: "app/api/data/route.ts", type: "blob" },
        { path: "app/widget.tsx", type: "blob" },
        { path: ".env.example", type: "blob" },
      ],
      {
        "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
        ".env.example": "KNOWN=value\n",
        "app/api/data/route.ts":
          'import { createBrowserClient } from "@supabase/ssr"; const value = process.env.MISSING;',
        "app/widget.tsx":
          '\"use client\"; const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;',
      },
    ),
  );

  assert.equal(results.checks.find((check) => check.id === "env")?.status, "red");
  assert.equal(results.checks.find((check) => check.id === "supabase")?.status, "red");
});
