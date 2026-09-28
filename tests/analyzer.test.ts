import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSnapshot, extractEnvReads, type RepositorySnapshot } from "../src/lib/analyzer";
import { parseChecks } from "../src/lib/categories";
import { defaultChecks, describeStack, detectStack } from "../src/lib/stack";
import { langFromCookieHeader, messages, parseLang, t } from "../src/lib/i18n";

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

const nextEntries: RepositorySnapshot["entries"] = [
  { path: "package.json", type: "blob" },
  { path: "app", type: "tree" },
  { path: "app/page.tsx", type: "blob" },
];
const page = { "app/page.tsx": "export default function Page() { return null }" };
const ids = (results: ReturnType<typeof analyzeSnapshot>) => results.checks.map((check) => check.id);

test("without a choice, a Next.js repo without Supabase never gets a Supabase check", () => {
  const results = analyzeSnapshot(snapshot(nextEntries, {
    "package.json": JSON.stringify({ dependencies: { next: "14.2.0", tailwindcss: "^3" } }), ...page,
  }));
  assert.deepEqual(ids(results), ["next-entry", "imports", "server-libs", "build-config", "env", "secrets"]);
  assert.deepEqual(results.scope, { scanned: ["next", "vercel", "env"], ignored: ["supabase", "prisma"] });
  assert.equal(results.stack?.hasSupabase, false);
  assert.equal(results.stack?.hasTailwind, true);
});

test("Supabase is detected from a dependency, an env template or source usage", () => {
  const files: Record<string, string> = { ...page };
  const variants: Array<Record<string, string>> = [
    { "package.json": JSON.stringify({ dependencies: { next: "15.0.0", "@supabase/supabase-js": "2" } }) },
    { "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }), ".env.example": "NEXT_PUBLIC_SUPABASE_URL=\n" },
    { "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }), "app/page.tsx": 'import { createClient } from "@supabase/supabase-js";' },
  ];
  for (const extra of variants) {
    const results = analyzeSnapshot(snapshot(nextEntries, { ...files, ...extra }));
    assert.equal(results.stack?.hasSupabase, true);
    assert.ok(ids(results).includes("supabase"));
  }
});

test("explicit checks run only the selected categories and record what was ignored", () => {
  const results = analyzeSnapshot(snapshot(nextEntries, {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6", "@supabase/ssr": "1" } }),
    "app/page.tsx": 'import { createBrowserClient } from "@supabase/ssr"; export default function Page() { return null }',
  }), { checks: ["vercel", "env"] });
  assert.deepEqual(ids(results), ["server-libs", "build-config", "env", "secrets"]);
  assert.deepEqual(results.scope?.ignored, ["next", "supabase", "prisma"]);
  assert.equal(results.checks.every((check) => check.category), true);
  assert.equal(results.summary.red + results.summary.yellow + results.summary.green, 4);
});

test("Prisma check flags a missing generate step and SQLite, and is skipped when unselected", () => {
  const files = {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6", "@prisma/client": "6" }, scripts: { build: "next build" } }),
    "prisma/schema.prisma": 'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n',
    ...page,
  };
  const entries = [...nextEntries, { path: "prisma/schema.prisma", type: "blob" as const }];
  const selected = analyzeSnapshot(snapshot(entries, files), { checks: ["prisma"] });
  const prisma = selected.checks[0];
  assert.equal(prisma.id, "prisma");
  assert.equal(prisma.status, "red");
  assert.equal(prisma.findings?.length, 2);

  assert.ok(ids(analyzeSnapshot(snapshot(entries, files))).includes("prisma")); // auto: Prisma detected
  const fixed = analyzeSnapshot(snapshot(entries, {
    ...files,
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6", "@prisma/client": "6" }, scripts: { postinstall: "prisma generate" } }),
    "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}\n',
  }), { checks: ["prisma"] });
  assert.equal(fixed.checks[0].status, "green");
});

test("parseChecks validates the checks payload", () => {
  assert.equal(parseChecks(undefined), undefined);
  assert.equal(parseChecks([]), null);
  assert.equal(parseChecks(["next", "bogus"]), null);
  assert.equal(parseChecks("next"), null);
  assert.deepEqual(parseChecks(["env", "next", "env"]), ["next", "env"]);
});

test("defaultChecks and describeStack follow the detected stack", () => {
  const stack = detectStack({ packageJson: JSON.stringify({ dependencies: { next: "^14.1.0", tailwindcss: "3" } }) });
  assert.deepEqual(defaultChecks(stack), ["next", "vercel", "env"]);
  assert.equal(describeStack(stack), "Next.js 14, Tailwind - No Supabase");
  assert.deepEqual(defaultChecks(detectStack({ packageJson: JSON.stringify({ dependencies: { express: "4", prisma: "6" } }) })), ["vercel", "env", "prisma"]);
  assert.deepEqual(defaultChecks(detectStack({ packageJson: null })), ["next", "vercel", "env"]);
});

test("English is the default language and Swedish is opt-in", () => {
  assert.equal(parseLang(undefined), "en");
  assert.equal(parseLang("fr"), "en");
  assert.equal(parseLang("sv"), "sv");
  assert.equal(langFromCookieHeader(null), "en");
  assert.equal(langFromCookieHeader("a=1; dd_lang=sv; b=2"), "sv");
  assert.equal(langFromCookieHeader("dd_lang=xx"), "en");
  assert.equal(t("en", "err.dailyLimit"), "You have used today's 3 free scans. Your saved reports are still free to read.");
  assert.match(t("sv", "err.dailyLimit"), /dagens 3 gratis/);
  assert.equal(t("en", "report.issues", { n: 3 }), "3 issues to fix");
});

test("every message exists in both languages with the same placeholders", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
  for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
    assert.ok(messages.sv[key], `missing sv: ${key}`);
    assert.equal(placeholders(messages.sv[key]), placeholders(messages.en[key]), `placeholders differ: ${key}`);
  }
  assert.equal(Object.keys(messages.sv).length, Object.keys(messages.en).length);
});

test("analysis text is English by default and Swedish on request", () => {
  const files = { "package.json": JSON.stringify({ dependencies: { next: "16.3.6", playwright: "1" } }), ...page };
  const english = analyzeSnapshot(snapshot(nextEntries, files));
  const swedish = analyzeSnapshot(snapshot(nextEntries, files), { lang: "sv" });
  assert.equal(english.checks.find((check) => check.id === "server-libs")?.title, "Vercel-incompatible server code");
  assert.match(english.checks.find((check) => check.id === "server-libs")?.explanation ?? "", /heavyweight browser/);
  assert.equal(swedish.checks.find((check) => check.id === "server-libs")?.title, "Vercel-inkompatibel serverkod");
  assert.deepEqual(english.checks.map((check) => check.status), swedish.checks.map((check) => check.status));
  assert.equal(describeStack(detectStack({ packageJson: JSON.stringify({ dependencies: { next: "14" } }) }), "sv"), "Next.js 14 - Ingen Supabase");
});

test("fixture strings inside test files are not reported as broken imports or env usage", () => {
  const results = analyzeSnapshot(snapshot(
    [...nextEntries, { path: "tests", type: "tree" }, { path: "tests/app.test.ts", type: "blob" }, { path: "app/x.spec.tsx", type: "blob" }],
    {
      "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
      ...page,
      "tests/app.test.ts": 'const src = \'import x from "./missing"; process.env.MISSING\';',
      "app/x.spec.tsx": 'import "./nope"; const k = process.env.NEXT_PUBLIC_SECRET_KEY;',
    },
  ), { checks: ["next", "env"] });
  assert.equal(results.checks.find((check) => check.id === "imports")?.status, "green");
  assert.equal(results.checks.find((check) => check.id === "env")?.status, "green");
});

test("Vercel system env variables are built in, but custom variables must be documented", () => {
  const results = analyzeSnapshot(snapshot(nextEntries, {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    "app/page.tsx": "const a = process.env.NEXT_PUBLIC_VERCEL_URL; const b = process.env.VERCEL_GIT_COMMIT_SHA;"
      + " const c = process.env.VERCEL_ENV; const d = process.env.MY_SECRET; export default function Page() { return null }",
  }), { checks: ["env"] });
  const env = results.checks[0];
  assert.equal(env.status, "red");
  assert.deepEqual(env.findings?.map((finding) => finding.problem), ["MY_SECRET is missing from .env.example"]);
});

test("an import that only matches a file with different letter case is red with the exact name", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries,
    { path: "components", type: "tree" }, { path: "components/ui", type: "tree" },
    { path: "components/button.tsx", type: "blob" }, { path: "components/ui/Card.tsx", type: "blob" }];
  const results = analyzeSnapshot(snapshot(entries, {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    "app/page.tsx": 'import Button from "../components/Button";\nimport { Card } from "@/components/UI/card";\nexport default function Page() { return null }',
  }), { checks: ["next"] });
  const imports = results.checks.find((check) => check.id === "imports");
  assert.equal(imports?.status, "red");
  assert.equal(imports?.findings?.length, 2);
  assert.match(imports?.findings?.[0].problem ?? "", /components\/button\.tsx/);
  assert.match(imports?.findings?.[0].fix ?? "", /"\.\.\/components\/button"/);
  assert.match(imports?.findings?.[1].fix ?? "", /"@\/components\/ui\/Card"/);
  assert.equal(imports?.findings?.[0].command, undefined);
});

test("imports with exactly matching letter case are not flagged", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries,
    { path: "components", type: "tree" }, { path: "components/Button.tsx", type: "blob" }, { path: "components/button.css", type: "blob" }];
  const results = analyzeSnapshot(snapshot(entries, {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    "app/page.tsx": 'import Button from "../components/Button";\nimport "@/components/button.css";\nexport default function Page() { return null }',
  }), { checks: ["next"] });
  assert.equal(results.checks.find((check) => check.id === "imports")?.status, "green");
});

test("env reads through destructuring and optional chaining are found", () => {
  const source = [
    'const { DATABASE_URL, API_KEY: apiKey, "QUOTED_NAME": quoted, WITH_DEFAULT = "x", ...rest } = process.env;',
    "const a = process.env?.OPTIONAL_READ; const b = process.env?.['OPTIONAL_BRACKET']; const c = process.env['BRACKET'];",
  ].join("\n");
  assert.deepEqual(extractEnvReads(source).map((read) => read.name),
    ["DATABASE_URL", "API_KEY", "QUOTED_NAME", "WITH_DEFAULT", "OPTIONAL_READ", "OPTIONAL_BRACKET", "BRACKET"]);

  const results = analyzeSnapshot(snapshot([...nextEntries, { path: ".env.example", type: "blob" }], {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    ".env.example": "DATABASE_URL=\n",
    "app/page.tsx": "const { DATABASE_URL, API_KEY: key } = process.env;\nexport default function Page() { return null }",
  }), { checks: ["env"] });
  assert.equal(results.checks[0].status, "red");
  assert.deepEqual(results.checks[0].findings?.map((finding) => [finding.problem, finding.line]), [["API_KEY is missing from .env.example", 1]]);
});

test("look-alikes of env destructuring are not treated as env reads", () => {
  const source = [
    "const { A, B } = process.envelope;",
    "const { C } = process.env.NESTED;",
    "const { d, e } = process.env;",
    "const f = process.env.lowercase;",
  ].join("\n");
  // Only the plain property read on line 2 counts; nothing is destructured from process.env itself.
  assert.deepEqual(extractEnvReads(source).map((read) => read.name), ["NESTED"]);
});

test("a .gitignore that hides .env.example gives a yellow env check with the line to add", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries, { path: ".gitignore", type: "blob" }, { path: ".env.local.example", type: "blob" }];
  const files = {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    ".env.local.example": "API_KEY=\n",
    "app/page.tsx": "const key = process.env.API_KEY; export default function Page() { return null }",
  };
  const env = analyzeSnapshot(snapshot(entries, { ...files, ".gitignore": "node_modules\n# env\n.env*\n" }), { checks: ["env"] }).checks[0];
  assert.equal(env.status, "yellow");
  assert.equal(env.findings?.[0].file, ".gitignore");
  assert.equal(env.findings?.[0].line, 3);
  assert.match(env.fix, /!\.env\.example/);

  // Missing variables stay red, and the .gitignore line is part of the fix.
  const red = analyzeSnapshot(snapshot(entries, { ...files, ".env.local.example": "", ".gitignore": ".env*\n!.env.example\n.env*\n" }), { checks: ["env"] }).checks[0];
  assert.equal(red.status, "red");
  assert.match(red.fix, /!\.env\.example/);
});

test("a .gitignore with the .env.example exception, or a tracked .env.example, is not flagged", () => {
  const files = {
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    ".env.example": "API_KEY=\n",
    "app/page.tsx": "const key = process.env.API_KEY; export default function Page() { return null }",
  };
  const entries: RepositorySnapshot["entries"] = [...nextEntries, { path: ".gitignore", type: "blob" }, { path: ".env.example", type: "blob" }];
  assert.equal(analyzeSnapshot(snapshot(entries, { ...files, ".gitignore": ".env*\n!.env.example\n" }), { checks: ["env"] }).checks[0].status, "green");
  // Tracked files stay tracked even if a rule matches them.
  assert.equal(analyzeSnapshot(snapshot(entries, { ...files, ".gitignore": ".env*\n" }), { checks: ["env"] }).checks[0].status, "green");
  // No env reads: no template is needed, so the rule does not matter.
  assert.equal(analyzeSnapshot(snapshot([...nextEntries, { path: ".gitignore", type: "blob" }], {
    ...page, "package.json": files["package.json"], ".gitignore": ".env*\n" }), { checks: ["env"] }).checks[0].status, "green");
});

test("build configuration: several lockfiles, no build script and an unsupported engines.node are yellow", () => {
  const packageJson = JSON.stringify({ packageManager: "pnpm@9.0.0", engines: { node: "18.x" },
    dependencies: { next: "16.3.6" }, scripts: { dev: "next dev" } }, null, 2);
  const entries: RepositorySnapshot["entries"] = [...nextEntries,
    { path: "package-lock.json", type: "blob" }, { path: "pnpm-lock.yaml", type: "blob" }];
  const build = analyzeSnapshot(snapshot(entries, { ...page, "package.json": packageJson }), { checks: ["vercel"] })
    .checks.find((check) => check.id === "build-config");
  assert.equal(build?.status, "yellow");
  assert.equal(build?.category, "vercel");
  assert.deepEqual(build?.findings?.map((finding) => finding.file), ["package-lock.json", "package.json", "package.json"]);
  assert.equal(build?.findings?.[0].command, "git rm -- 'package-lock.json'");
  assert.match(build?.findings?.[2].problem ?? "", /"18\.x"/);
});

test("build configuration: one lockfile, a build script and supported Node ranges are green", () => {
  for (const node of [">=18", "^20.11.0", "20.x || 22.x", ">= 22.0.0 < 23", "18 - 20", "24", "*", "lts/*"]) {
    const packageJson = JSON.stringify({ engines: { node }, dependencies: { next: "16.3.6" }, scripts: { build: "next build" } });
    const entries: RepositorySnapshot["entries"] = [...nextEntries, { path: "pnpm-lock.yaml", type: "blob" }, { path: "sub/package-lock.json", type: "blob" }];
    const build = analyzeSnapshot(snapshot(entries, { ...page, "package.json": packageJson }), { checks: ["vercel"] })
      .checks.find((check) => check.id === "build-config");
    assert.equal(build?.status, "green", node);
  }
  // vercel.json can supply the build command instead of package.json.
  const viaVercel = analyzeSnapshot(snapshot([...nextEntries, { path: "vercel.json", type: "blob" }], { ...page,
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }), "vercel.json": '{ "buildCommand": "next build" }' }), { checks: ["vercel"] });
  assert.equal(viaVercel.checks.find((check) => check.id === "build-config")?.status, "green");
});

test("Node-only imports in Edge runtime code are red in server-libs", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries,
    { path: "middleware.ts", type: "blob" }, { path: "app/api/og/route.ts", type: "blob" }];
  const results = analyzeSnapshot(snapshot(entries, {
    ...page,
    "package.json": JSON.stringify({ dependencies: { next: "15.1.0" } }),
    "middleware.ts": 'import { NextResponse } from "next/server";\nimport { readFileSync } from "node:fs";\nexport function middleware() { return NextResponse.next() }',
    "app/api/og/route.ts": 'export const runtime = "edge";\nconst { exec } = require("child_process");\nexport async function GET() { return new Response("ok") }',
  }), { checks: ["vercel"] });
  const server = results.checks.find((check) => check.id === "server-libs");
  assert.equal(server?.status, "red");
  assert.deepEqual(server?.findings?.map((finding) => `${finding.file}:${finding.line}`).sort(), ["app/api/og/route.ts:2", "middleware.ts:2"]);
  assert.match(server?.findings?.find((finding) => finding.file === "middleware.ts")?.fix ?? "", /proxy\.ts/);
});

test("Edge-safe code, Node.js middleware, proxy.ts and type-only imports are not flagged", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries,
    { path: "src/middleware.ts", type: "blob" }, { path: "proxy.ts", type: "blob" }, { path: "app/api/a/route.ts", type: "blob" }, { path: "app/api/b/route.ts", type: "blob" }];
  const results = analyzeSnapshot(snapshot(entries, {
    ...page,
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    "src/middleware.ts": 'import fs from "fs";\nexport const config = { runtime: "nodejs", matcher: "/" };\nexport function middleware() {}',
    "proxy.ts": 'import { readFile } from "node:fs/promises";\nexport function proxy() {}',
    "app/api/a/route.ts": 'export const runtime = "edge";\nimport type { Stats } from "fs";\nimport { type Socket } from "net";\n// import fs from "fs";\nimport { NextResponse } from "next/server";',
    "app/api/b/route.ts": '// export const runtime = "edge";\nimport fs from "fs";\nexport async function GET() { return new Response(String(fs)) }',
  }), { checks: ["vercel"] });
  assert.equal(results.checks.find((check) => check.id === "server-libs")?.status, "green");
});

// Built by concatenation so no complete key-shaped string is ever committed in this file.
const fakeBody = "Qm7Rk2Vt9Lp4Xw8Zn3Jc6Hb1Fg5Ds0Ay";
const liveStripe = "sk_" + "live_" + fakeBody;

test("hardcoded live secrets in current source files are red and always masked", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries, { path: "lib/pay.ts", type: "blob" }, { path: ".env", type: "blob" }, { path: "lib/key.ts", type: "blob" }];
  const pem = "-----BEGIN RSA " + "PRIVATE KEY-----\\n" + "MIIEowIBAAKCAQEA7bq9" + fakeBody + "Tz\\n-----END RSA PRIVATE KEY-----";
  const results = analyzeSnapshot(snapshot(entries, {
    ...page,
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    "lib/pay.ts": `export const stripe = new Stripe("${liveStripe}");`,
    ".env": `AWS_ACCESS_KEY_ID=${"AKIA" + "Q4ZT7NR2WX5KLM3B"}\nGITHUB_TOKEN=${"ghp_" + fakeBody + "a1B2"}\n`,
    "lib/key.ts": `const key = "${pem}";`,
  }), { checks: ["env"] });
  const secrets = results.checks.find((check) => check.id === "secrets");
  assert.equal(secrets?.status, "red");
  assert.equal(secrets?.category, "env");
  assert.deepEqual(secrets?.findings?.map((finding) => `${finding.file}:${finding.line}`).sort(), [".env:1", ".env:2", "lib/key.ts:1", "lib/pay.ts:1"]);
  const everything = JSON.stringify(results);
  assert.ok(!everything.includes(fakeBody), "no secret body may appear anywhere in the report");
  assert.ok(everything.includes("sk_live_…" + fakeBody.slice(-4)));
  assert.ok(everything.includes("-----BEGIN RSA PRIVATE KEY-----…"));
});

test("placeholders, test files, empty templates and test-mode keys are not reported as secrets", () => {
  const entries: RepositorySnapshot["entries"] = [...nextEntries, { path: ".env.example", type: "blob" }, { path: "lib/docs.ts", type: "blob" }, { path: "tests/pay.test.ts", type: "blob" }];
  const results = analyzeSnapshot(snapshot(entries, {
    ...page,
    "package.json": JSON.stringify({ dependencies: { next: "16.3.6" } }),
    ".env.example": "STRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=whsec_...\nAWS_ACCESS_KEY_ID=" + "AKIA" + "IOSFODNN7EXAMPLE\n",
    "lib/docs.ts": [
      "// Stripe keys look like " + "sk_" + "live_xxxxxxxxxxxxxxxxxxxxxxxx",
      "const hint = \"" + "sk_" + "live_" + "your_key_here_0000000000000\";",
      "const test = \"sk_" + "test_" + fakeBody + "\";",
      "const strip = key.replace(\"-----BEGIN PRIVATE " + "KEY-----\", \"\");",
      "const pat = \"" + "ghp_" + "0".repeat(36) + "\";",
    ].join("\n"),
    "tests/pay.test.ts": `const key = "${liveStripe}";`,
  }), { checks: ["env"] });
  assert.equal(results.checks.find((check) => check.id === "secrets")?.status, "green");
});
