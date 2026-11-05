import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../src/lib/analyzer";
import { nodeRangeAllowsMajor } from "../src/lib/node-range";
import { applyVerifiedDiff, verifiedFileDiff } from "../src/lib/patch/case-patch";
import { planDeployFixes } from "../src/lib/fix-pr/deploy-fixes";
import { t } from "../src/lib/i18n";

function snap(files: Record<string, string>, extra: string[] = []): RepositorySnapshot {
  const contents = new Map(Object.entries(files).map(([path, source]) => [path, source.endsWith("\n") ? source : `${source}\n`]));
  return {
    owner: "acme", name: "app", defaultBranch: "main", partial: false,
    sourceFilesFound: contents.size, sourceFilesRead: contents.size,
    entries: [...contents.keys(), ...extra].map((path) => ({ path, type: "blob" as const })),
    contents,
  };
}

function changed(plan: ReturnType<typeof planDeployFixes>, file: string, before: string) {
  const diff = plan.patch.split(/(?=^diff --git )/m).find((part) => part.startsWith(`diff --git a/${file} b/${file}\n`));
  assert.ok(diff, file);
  const source = before.endsWith("\n") || before === "" ? before : `${before}\n`;
  return applyVerifiedDiff(file, source, diff!);
}

test("a full-file diff can add a line and a new file", () => {
  const added = verifiedFileDiff("package.json", "{\n}\n", "{\n  \"a\": 1\n}\n");
  assert.equal(applyVerifiedDiff("package.json", "{\n}\n", added), "{\n  \"a\": 1\n}\n");
  const created = verifiedFileDiff(".nvmrc", "", "22\n");
  assert.equal(applyVerifiedDiff(".nvmrc", "", created), "22\n");
});

test("client env reads gain the public prefix and .env.example lists them empty", () => {
  const page = '"use client";\nexport const url = process.env.SUPABASE_URL;\n';
  const plan = planDeployFixes(snap({ "package.json": '{ "dependencies": { "next": "16.0.0" } }\n', "app/page.tsx": page }));
  const next = changed(plan, "app/page.tsx", page);
  assert.match(next, /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.doesNotMatch(next, /process\.env\.SUPABASE_URL\b/);
  const example = changed(plan, ".env.example", "");
  assert.match(example, /^NEXT_PUBLIC_SUPABASE_URL=\s*$/m);
  assert.equal(plan.fixes.find((fix) => fix.id === "env-prefix")?.label, "verified");
});

test("a secret-looking client env name is not renamed", () => {
  const page = '"use client";\nexport const key = process.env.STRIPE_SECRET_KEY;\n';
  const plan = planDeployFixes(snap({ "package.json": '{ "dependencies": { "next": "16.0.0" } }\n', "app/page.tsx": page }));
  assert.equal(plan.files.includes("app/page.tsx"), false);
  assert.match(plan.notes, /STRIPE_SECRET_KEY/);
  assert.equal(plan.fixes.some((fix) => fix.label === "instructions" && /secret/i.test(fix.summary) || plan.notes.includes("secret")), true);
});

test("an unsupported Node range is pinned to 22 and .nvmrc matches", () => {
  const pkg = '{ "engines": { "node": "16.x" } }\n';
  const plan = planDeployFixes(snap({ "package.json": pkg, ".nvmrc": "16\n" }));
  const next = changed(plan, "package.json", pkg);
  assert.equal(JSON.parse(next).engines.node, "22.x");
  assert.equal(nodeRangeAllowsMajor(JSON.parse(next).engines.node, [20, 22, 24]), true);
  assert.equal(changed(plan, ".nvmrc", "16\n"), "22\n");
  assert.equal(plan.fixes.find((fix) => fix.id === "node")?.label, "verified");
});

test("a supported Node range is left alone", () => {
  const plan = planDeployFixes(snap({ "package.json": '{ "engines": { "node": "22.x" } }\n', ".nvmrc": "22\n", "app/page.tsx": "export default function Page(){return null}\n" }));
  assert.equal(plan.fixes.some((fix) => fix.id === "node"), false);
});

test("Next on Vercel gets the nextjs framework and a build script", () => {
  const pkg = '{ "dependencies": { "next": "16.0.0" } }\n';
  const vercel = '{ "framework": "vite" }\n';
  const plan = planDeployFixes(snap({ "package.json": pkg, "vercel.json": vercel }));
  assert.equal(JSON.parse(changed(plan, "vercel.json", vercel)).framework, "nextjs");
  assert.equal(JSON.parse(changed(plan, "package.json", pkg)).scripts.build, "next build");
});

test("a Vite single-page app gets a Vercel rewrite and output export stays an instruction", () => {
  const plan = planDeployFixes(snap({
    "package.json": '{ "dependencies": { "vite": "6.0.0" } }\n',
    "src/main.tsx": "export const app = 1;\n",
    "next.config.ts": 'const config = { output: "export" };\nexport default config;\n',
  }));
  const vercel = changed(plan, "vercel.json", "");
  assert.equal(JSON.parse(vercel).rewrites[0].destination, "/index.html");
  assert.match(plan.notes, /output: "export"/);
  assert.equal(plan.files.includes("next.config.ts"), false);
});

test("a missing import is added only when no lockfile is committed", () => {
  const pkg = '{ "name": "app", "dependencies": {} }\n';
  const source = 'import pad from "left-pad";\nexport const value = pad;\n';
  const open = planDeployFixes(snap({ "package.json": pkg, "src/main.ts": source }));
  assert.equal(JSON.parse(changed(open, "package.json", pkg)).dependencies["left-pad"], "*");
  assert.equal(open.fixes.find((fix) => fix.id === "dependency")?.label, "verified");
  const locked = planDeployFixes(snap({ "package.json": pkg, "src/main.ts": source }, ["package-lock.json"]));
  assert.equal(locked.files.includes("package.json"), false);
  assert.equal(locked.fixes.find((fix) => fix.id === "dependency")?.label, "instructions");
  assert.match(locked.notes, /left-pad/);
});

test("a localhost Supabase redirect uses the browser origin, and site_url stays an instruction", () => {
  const source = 'import { createClient } from "@supabase/supabase-js";\nexport const go = () => createClient("", "").auth.signInWithOAuth({ redirectTo: "http://localhost:3000/auth/callback" });\n';
  const plan = planDeployFixes(snap({ "src/auth.ts": source, "supabase/config.toml": 'site_url = "http://localhost:3000"\n' }));
  const next = changed(plan, "src/auth.ts", source);
  assert.match(next, /window\.location\.origin/);
  assert.doesNotMatch(next, /localhost/);
  assert.equal(plan.files.includes("supabase/config.toml"), false);
  assert.match(plan.notes, /Supabase dashboard/);
  assert.equal(plan.fixes.find((fix) => fix.id === "supabase-site-url")?.label, "instructions");
});

test("nothing verifiable and no instruction produces no paid patch", () => {
  const plan = planDeployFixes(snap({ "package.json": '{ "dependencies": { "next": "16.0.0" }, "scripts": { "build": "next build" } }\n', "app/page.tsx": "export default function Page(){return null}\n" }));
  assert.equal(plan.patch, "");
  assert.equal(plan.fixes.length, 0);
});

test("the landing hero states the fix promise only when Fix pull requests are switched on", () => {
  assert.equal(t("en", "home.h1.fix"), "Paste your broken deploy. Get a fix PR in 60 seconds.");
  assert.match(t("en", "home.copy.fix"), /^No fix, no pay\. First 50 free\./);
  assert.match(t("sv", "home.h1.fix"), /60 sekunder/);
  assert.match(t("sv", "home.copy.fix"), /Ingen fix, ingen betalning/);
  const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /t\(fixOn \? "home\.h1\.fix" : "home\.h1"\)/);
  assert.match(page, /const fixOn = fixPullRequestsEnabled\(\)/);
  assert.match(page, /The pull request is coming soon/);
  assert.match(page, /fixOn \? \(lang === "sv" \? "Klistra in repot\. Diagnosen är gratis\. Pull requesten kostar 49 kr\." : "Paste the repo\. Diagnosis is free\. The pull request is \$5\."\)/);
});
