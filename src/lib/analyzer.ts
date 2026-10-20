import path from "node:path";
import type { Category, CheckResult, CheckStatus, ReportResults, Finding } from "@/types/report";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { defaultChecks, detectStack, type Stack } from "@/lib/stack";
import { analysisText, type AnalysisText } from "@/lib/analysis-text";
import type { Lang } from "@/lib/i18n";
import { ignoringRule } from "@/lib/gitignore";
import { nodeRangeAllowsMajor } from "@/lib/node-range";
import { findSecrets } from "@/lib/secrets";
import { auditMigrations, grantSql, MIGRATION_FILE } from "@/lib/supabase-sql";
import { dailyVersion, parseVercelCron, runsMoreThanOnceADay } from "@/lib/vercel-cron";
import { lockfileMentions, manifestSpecifiers, moduleImports, npmMissingLinuxBinaries, npmRootSpecifiers, packageName, pnpmOverrides, pnpmRootSpecifiers, stripComments,
  specifierDrift, tsconfigAliases } from "@/lib/dependencies";

export type RepositorySnapshot = {
  owner: string;
  name: string;
  defaultBranch: string;
  entries: Array<{ path: string; type: "blob" | "tree"; size?: number }>;
  contents: Map<string, string>;
  sourceFilesFound: number;
  sourceFilesRead: number;
  partial: boolean;
  partialReasons?: string[];
};

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
// Test files hold fixture strings that look like imports and env usage; they never run on Vercel.
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|__mocks__|fixtures|spec)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i;
const RESOLVABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".svg",
];
const API_ROUTE = /(?:^|\/)(?:src\/)?app\/api(?:\/.*)?\/route\.[cm]?[jt]s$|(?:^|\/)(?:src\/)?pages\/api\/.*\.[cm]?[jt]s$/i;
const SERVER_COMPONENT = /(?:^|\/)(?:src\/)?app(?:\/.*)?\/(?:page|layout|loading|default|not-found)\.[jt]sx$/i;
const BUILT_IN_ENV = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "CI",
]);
// Vercel's system env vars (VERCEL_URL, VERCEL_GIT_COMMIT_SHA, NEXT_PUBLIC_VERCEL_ENV, ...) are set by the platform.
const VERCEL_SYSTEM_ENV = /^(?:NEXT_PUBLIC_)?VERCEL(?:_[A-Z0-9_]+)?$/;

// GitHub Actions runner variables (GITHUB_OUTPUT, RUNNER_TEMP, ACTIONS_ID_TOKEN_REQUEST_URL, INPUT_<name>, ...)
// are set for workflow and action scripts. GITHUB_TOKEN is deliberately not one: apps read it as their own secret.
const GITHUB_ACTIONS_ENV = new Set([
  "GITHUB_ACTION", "GITHUB_ACTION_PATH", "GITHUB_ACTION_REF", "GITHUB_ACTION_REPOSITORY", "GITHUB_ACTIONS",
  "GITHUB_ACTOR", "GITHUB_ACTOR_ID", "GITHUB_API_URL", "GITHUB_BASE_REF", "GITHUB_ENV", "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH", "GITHUB_GRAPHQL_URL", "GITHUB_HEAD_REF", "GITHUB_JOB", "GITHUB_OUTPUT", "GITHUB_PATH",
  "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_REF_PROTECTED", "GITHUB_REF_TYPE", "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_RETENTION_DAYS",
  "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID", "GITHUB_RUN_NUMBER", "GITHUB_SERVER_URL", "GITHUB_SHA", "GITHUB_STATE",
  "GITHUB_STEP_SUMMARY", "GITHUB_TRIGGERING_ACTOR", "GITHUB_WORKFLOW", "GITHUB_WORKFLOW_REF", "GITHUB_WORKFLOW_SHA",
  "GITHUB_WORKSPACE", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_RUNTIME_URL", "ACTIONS_CACHE_URL", "ACTIONS_RESULTS_URL", "ACTIONS_STEP_DEBUG", "ACTIONS_RUNNER_DEBUG",
]);
const GITHUB_ACTIONS_PATTERN = /^(?:RUNNER_[A-Z0-9_]+|INPUT_[A-Z0-9_-]+)$/;

function isBuiltInEnv(name: string): boolean {
  return BUILT_IN_ENV.has(name) || VERCEL_SYSTEM_ENV.test(name) || GITHUB_ACTIONS_ENV.has(name) || GITHUB_ACTIONS_PATTERN.test(name);
}

function makeCheck(
  id: CheckResult["id"],
  title: string,
  status: CheckStatus,
  explanation: string,
  fix: string,
  evidence: string[] = [],
  findings: Finding[] = [],
): CheckResult {
  return { id, category: categoryOf({ id }), title, status, explanation, fix, evidence: evidence.slice(0, 8), findings };
}

function lineAt(source: string, index: number) { return source.slice(0, index).split("\n").length; }
function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function partialFix(snapshot: RepositorySnapshot, x: AnalysisText) {
  return !snapshot.partialReasons?.length || snapshot.partialReasons.includes("rate_limit") ? x.partialFixToken : x.partialFixRetry;
}
function partialMessage(snapshot: RepositorySnapshot, x: AnalysisText) {
  return x.partialMessage(snapshot.sourceFilesRead, snapshot.sourceFilesFound, Boolean(snapshot.partialReasons?.includes("rate_limit")));
}

function parsePackageJson(snapshot: RepositorySnapshot) {
  const raw = snapshot.contents.get("package.json");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      name?: string;
      scripts?: Record<string, string>;
      engines?: Record<string, unknown>;
      workspaces?: unknown;
      packageManager?: string;
      pnpm?: { overrides?: Record<string, string>; onlyBuiltDependencies?: string[] };
    };
  } catch {
    return null;
  }
}

function checkNextEntrypoint(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const manifest = parsePackageJson(snapshot);
  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const hasNext = Boolean(packages.next);
  const routeRoots = ["app", "pages", "src/app", "src/pages"];
  const hasRouteFolder = snapshot.entries.some((entry) =>
    routeRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`)),
  );
  const title = x.titles.nextEntry;

  if (hasNext && !hasRouteFolder) {
    return makeCheck("next-entry", title, "red", x.next.missingFolder, x.next.missingFolderFix,
      ["package.json → next", x.next.noRouteEvidence]);
  }
  if (!manifest) {
    return makeCheck("next-entry", title, "yellow", x.next.unreadable, x.next.unreadableFix);
  }
  return makeCheck("next-entry", title, "green", hasNext ? x.next.found : x.next.notNext, x.noChange,
    hasNext ? ["package.json → next", x.next.routeFound] : []);
}

function extractImports(source: string, fileName = "source.tsx") {
  return moduleImports(source, fileName, true);
}

function possibleImportTargets(base: string): string[] {
  const clean = path.posix.normalize(base).replace(/^\.\//, "");
  const targets = [clean];
  if (/\.[cm]?jsx?$/.test(clean)) {
    targets.push(clean.replace(/\.js$/, ".ts"), clean.replace(/\.js$/, ".tsx"),
      clean.replace(/\.mjs$/, ".mts"), clean.replace(/\.cjs$/, ".cts"), clean.replace(/\.jsx$/, ".tsx"));
  }
  for (const extension of RESOLVABLE_EXTENSIONS) {
    targets.push(`${clean}${extension}`, `${clean}/index${extension}`);
  }
  return targets;
}

type AliasRoots = Array<{ prefix: string; roots: string[] }>;

/** The tsconfig or jsconfig text by the folder it sits in. A nested app (a monorepo example, a docs site) resolves from its own. */
function aliasConfigs(snapshot: RepositorySnapshot): Map<string, string> {
  const configs = new Map<string, string>();
  for (const [file, raw] of snapshot.contents) {
    const match = /^(?:(.*)\/)?(tsconfig|jsconfig)\.json$/.exec(file);
    if (!match) continue;
    // tsconfig wins over jsconfig in the same folder, as it does for TypeScript itself.
    if (match[2] === "jsconfig" && configs.has(match[1] ?? "")) continue;
    configs.set(match[1] ?? "", raw);
  }
  return configs;
}

/** The folder of the config that governs `file`: the nearest one above it, else the root ("" even when there is none). */
function nearestConfigDir(file: string, configs: Map<string, string>): string {
  let dir = path.posix.dirname(file);
  while (dir !== "." && dir !== "") {
    if (configs.has(dir)) return dir;
    dir = path.posix.dirname(dir);
  }
  return "";
}

/**
 * Every `@/...` alias from the config's paths, longest prefix first, so `@/public/*` wins over `@/*` the way
 * TypeScript resolves it. Targets and baseUrl are relative to the config's folder. Without a tsconfig entry,
 * `@/` means `src/` or the folder itself.
 */
function aliasRoots(raw: string, dir: string): AliasRoots {
  const config = tsconfigAliases(raw);
  const under = (target: string) => path.posix.join(dir, config.baseUrl ?? "", target).replace(/\/$/, "").replace(/^\.$/, "");
  const aliases = config.prefixes.filter(item => item.prefix.startsWith("@/")).map(item => ({ prefix: item.prefix, roots: item.targets.map(under) }));
  if (!aliases.some(alias => alias.prefix === "@/")) {
    aliases.push({ prefix: "@/", roots: config.baseUrl !== undefined ? [under("")] : [path.posix.join(dir, "src"), dir].map(root => root.replace(/^\.$/, "")) });
  }
  return aliases.sort((left, right) => right.prefix.length - left.prefix.length);
}

/** Rebuilds `wanted` with the letter case of `actual` wherever the two only differ in case. */
function withCaseOf(wanted: string, actual: string): string {
  return [...wanted].map((char, index) => actual[index]?.toLowerCase() === char.toLowerCase() ? actual[index] : char).join("");
}

/**
 * An import that does not resolve on Linux. `case` means a tracked file matches except for letter case,
 * and `exact` is the specifier spelled the way the file is named; `missing` means no file matches at all.
 */
export type ImportProblem =
  | { kind: "case"; file: string; line: number; specifier: string; actual: string; exact: string }
  | { kind: "missing"; file: string; line: number; specifier: string; target: string; uncertain?: boolean; ambiguous?: boolean };

/** Every unresolved relative or `@/` import in the snapshot's source files. The imports check and the patch service share it. */
export function importProblems(snapshot: RepositorySnapshot): ImportProblem[] {
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  // Linux file systems (and so Vercel builds) are case-sensitive; macOS and Windows are not.
  const filesByLowerCase = new Map<string, string[]>();
  for (const file of files) filesByLowerCase.set(file.toLowerCase(), [...(filesByLowerCase.get(file.toLowerCase()) ?? []), file]);
  const configs = aliasConfigs(snapshot);
  const aliasesByDir = new Map<string, AliasRoots>();
  const problems: ImportProblem[] = [];

  for (const [file, source] of snapshot.contents) {
    // next-env.d.ts intentionally references generated .next type files that are gitignored.
    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file) || /\.d\.[cm]?ts$/.test(file)) continue;
    const configDir = nearestConfigDir(file, configs);
    const config = configs.get(configDir) ?? "";
    let aliases = aliasesByDir.get(configDir);
    if (!aliases) { aliases = aliasRoots(config, configDir); aliasesByDir.set(configDir, aliases); }

    for (const { specifier: original, line } of extractImports(source, file)) {
      const specifier = original.split(/[?#]/)[0];
      let bases: Array<{ base: string; toSpecifier: (resolved: string) => string }> = [];
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const directory = path.posix.dirname(file);
        bases = [{ base: path.posix.join(directory, specifier), toSpecifier: (resolved) => {
          const relative = path.posix.relative(directory, resolved);
          return relative.startsWith("../") ? relative : `./${relative}`;
        } }];
      } else if (specifier.startsWith("@/")) {
        const alias = aliases.find((candidate) => specifier.startsWith(candidate.prefix))!;
        bases = alias.roots.map((root) => ({ base: path.posix.join(root, specifier.slice(alias.prefix.length)),
          toSpecifier: (resolved: string) => `${alias.prefix}${root ? resolved.slice(root.length + 1) : resolved}` }));
      } else {
        continue;
      }
      const candidates = bases.flatMap(({ base }) => possibleImportTargets(base));

      if (!candidates.some((candidate) => files.has(candidate))) {
        const matches = bases.flatMap(({ base, toSpecifier }) => possibleImportTargets(base).flatMap(candidate =>
          (filesByLowerCase.get(candidate.toLowerCase()) ?? []).map(actual => ({
            base: path.posix.normalize(base).replace(/^\.\//, ""), toSpecifier, actual }))));
        const uniqueTargets = new Set(matches.map(item => item.actual));
        if (uniqueTargets.size > 1) {
          problems.push({ kind: "missing", file, line, specifier: original, target: candidates[0], uncertain: true, ambiguous: true });
          continue;
        }
        const caseMatch = matches[0];
        if (caseMatch?.actual) {
          const exact = caseMatch.toSpecifier(withCaseOf(caseMatch.base, caseMatch.actual));
          problems.push({ kind: "case", file, line, specifier: original, actual: caseMatch.actual, exact });
          continue;
        }
        const scripts = snapshot.contents.get("package.json") ?? "";
        const uncertain = snapshot.partialReasons?.includes("truncated_tree") || /"extends"\s*:/.test(config)
          || /(?:generate|codegen|prisma\s+generate)/i.test(scripts)
          || candidates.some(candidate => /(?:^|\/)(?:generated|__generated__|\.next|\.nuxt|\.svelte-kit)(?:\/|\.)/.test(candidate)
            || ignoringRule(snapshot.contents.get(".gitignore") ?? "", candidate));
        problems.push({ kind: "missing", file, line, specifier: original, target: candidates[0], ...(uncertain ? { uncertain: true } : {}) });
      }
    }
  }
  return problems;
}

function checkImports(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const problems = importProblems(snapshot);
  const caseMismatches = problems.filter((problem) => problem.kind === "case").length;
  const missing: Finding[] = problems.map((problem) => problem.kind === "case"
    ? { file: problem.file, line: problem.line, problem: x.imports.caseProblem(problem.specifier, problem.actual), fix: x.imports.caseFix(problem.exact, problem.line) }
    : problem.ambiguous
      ? { file: problem.file, line: problem.line, problem: x.imports.ambiguous(problem.specifier), fix: x.imports.review }
      : { file: problem.file, line: problem.line, problem: x.imports.problem(problem.specifier), fix: x.imports.fix(problem.target, problem.line),
        // git add needs the real file name; a specifier without an extension only gives the base, which git rejects.
        ...(/\.[A-Za-z0-9]+$/.test(problem.target) ? { command: `git add -- ${shellQuote(problem.target)}` } : {}) });

  if (missing.length) {
    return makeCheck(
      "imports",
      x.titles.imports,
      problems.some(problem => problem.kind === "case" || !problem.uncertain) ? "red" : "yellow",
      x.imports.summary(missing.length, caseMismatches),
      missing[0].fix,
      missing.map((item) => `${item.file}:${item.line} → ${item.problem}`), missing,
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "imports",
      x.titles.imports,
      "yellow",
      partialMessage(snapshot, x),
      partialFix(snapshot, x),
      [`${x.imports.read(snapshot.sourceFilesRead)} / ${snapshot.sourceFilesFound}`],
    );
  }

  return makeCheck("imports", x.titles.imports, "green", x.imports.ok, x.noChange, [x.imports.read(snapshot.sourceFilesRead)]);
}

// Node built-ins and packages that cannot load in the Edge runtime, matched by exact module name.
const NODE_ONLY_MODULES = new Set([
  "fs", "fs/promises", "child_process", "net", "tls", "dgram", "dns", "dns/promises", "cluster", "worker_threads",
  "readline", "http2", "v8", "vm", "inspector", "repl",
  "better-sqlite3", "sqlite3", "bcrypt", "argon2", "sharp", "canvas", "nodemailer",
  "puppeteer", "puppeteer-core", "playwright", "playwright-core",
]);
const EDGE_RUNTIME = /^\s*export\s+const\s+(?:runtime\s*=\s*["'](?:experimental-)?edge["']|config\s*=\s*\{[^}]*\bruntime\s*:\s*["'](?:experimental-)?edge["'])/m;
// middleware.ts runs on the Edge runtime unless it opts into Node.js (Next.js 15.5+); proxy.ts always runs on Node.js.
const MIDDLEWARE = /^(?:src\/)?middleware\.[cm]?[jt]s$/;
const NODE_RUNTIME_CONFIG = /^\s*export\s+const\s+config\s*=\s*\{[^}]*\bruntime\s*:\s*["']nodejs["']/m;

/** Imports that exist at runtime: type-only imports and commented-out lines are skipped. */
function runtimeImports(source: string) {
  return moduleImports(source);
}

function edgeRuntimeFindings(snapshot: RepositorySnapshot, x: AnalysisText): Finding[] {
  const findings: Finding[] = [];
  for (const [file, source] of snapshot.contents) {
    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file)) continue;
    const middleware = MIDDLEWARE.test(file) && !NODE_RUNTIME_CONFIG.test(source);
    if (!middleware && !EDGE_RUNTIME.test(source)) continue;
    for (const { specifier, line } of runtimeImports(source)) {
      const name = specifier.replace(/^node:/, "");
      if (!NODE_ONLY_MODULES.has(name)) continue;
      findings.push({ file, line, problem: x.server.edgeProblem(name), fix: middleware ? x.server.edgeMiddlewareFix(name) : x.server.edgeFix(name) });
    }
  }
  return findings;
}

function checkServerLibraries(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const manifest = parsePackageJson(snapshot);
  const RISKY = /^(?:playwright|playwright-core|@playwright\/test|puppeteer|puppeteer-core|sqlite3|better-sqlite3)$/;
  // A devDependency only matters when application code imports it: Playwright as an end-to-end test runner never ships.
  const TOOLING_FILE = /(?:^|\/)(?:e2e|playwright|cypress|\.storybook)\/|\.config\.[cm]?[jt]s$/i;
  const importedByApp = (name: string) => [...snapshot.contents].some(([file, source]) =>
    SOURCE_EXTENSION.test(file) && !TEST_FILE.test(file) && !TOOLING_FILE.test(file) && extractImports(source).some(({ specifier }) => specifier === name || specifier.startsWith(`${name}/`)));
  const riskyPackages = [
    ...Object.keys(manifest?.dependencies ?? {}).filter((name) => RISKY.test(name)),
    ...Object.keys(manifest?.devDependencies ?? {}).filter((name) => RISKY.test(name) && !(name in (manifest?.dependencies ?? {})) && importedByApp(name)),
  ];
  const fsWrites: string[] = [];
  const writePattern = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rename|renameSync|unlink|unlinkSync|rm|rmSync)\s*\(/;

  for (const [file, source] of snapshot.contents) {
    if (API_ROUTE.test(file) && /(?:node:fs|["']fs["'])/.test(source) && writePattern.test(source)) {
      fsWrites.push(file);
    }
  }
  const edge = edgeRuntimeFindings(snapshot, x);

  const evidence = [
    ...edge.map((item) => `${item.file}:${item.line} → ${item.problem}`),
    ...riskyPackages.map((name) => `package.json → ${name}`),
    ...fsWrites.map((file) => x.server.write(file)),
  ];
  const title = x.titles.serverLibs;
  if (evidence.length) {
    const other = riskyPackages.length + fsWrites.length > 0;
    return makeCheck("server-libs", title, "red",
      [edge.length ? x.server.edgeRed(edge.length) : "", other ? x.server.red : ""].filter(Boolean).join(" "),
      [edge.length ? edge[0].fix : "", other ? x.server.fix : ""].filter(Boolean).join(" "),
      evidence,
      // Findings replace the evidence in the copied instructions, so list the other problems too when there are any.
      edge.length ? [...edge,
        ...riskyPackages.map((name) => ({ file: "package.json", line: 1, problem: x.server.packageProblem(name), fix: x.server.fix })),
        ...fsWrites.map((file) => ({ file, line: 1, problem: x.server.writeProblem, fix: x.server.fix }))] : undefined);
  }
  if (snapshot.partial) return makeCheck("server-libs", title, "yellow", x.server.partial, partialFix(snapshot, x));
  return makeCheck("server-libs", title, "green", x.server.ok, x.noChange);
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_ACCESS = /process\.env(?:\??\.([A-Z][A-Z0-9_]*)\b|(?:\?\.)?\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/;
/**
 * Right after a read: `?? "x"`, `|| 3000` or `` || `x` `` (a non-empty string, number or template literal), or the `?` of a
 * ternary (captured). An empty string, as in `process.env.KEY || ""`, only quiets the type checker: the value is still missing.
 */
const ENV_FALLBACK = /\s*(?:\?\?|\|\|)\s*(?:"(?!")|'(?!')|`(?!`)|-?\.?\d)|\s*(\?)(?![?.])/y;
/** Right before a read: the test of a ternary on an env variable, as in `process.env.X ? process.env.X : "x"`. */
const ENV_TERNARY_TEST = new RegExp(`${ENV_ACCESS.source}\\s*\\?\\s*$`);
/**
 * Right before a read: a binary operator, so a ternary after the read tests the whole expression, as in
 * `a === process.env.X ? b : c`. So does a fallback, except after `&&`, `||` or `??` (captured), as in `process.env.A ?? process.env.B ?? "x"`.
 */
const ENV_OPERATOR = /(?:[=!]==?|(?<!=)[<>]=?|[+\-*/%&|^]|\binstanceof|\bin|(&&|\|\||\?\?))\s*$/;

/**
 * process.env.X, process.env?.X, process.env["X"], process.env?.["X"] and `const { X, Y: y = "" } = process.env`.
 * A read is optional when the code already copes with the variable being unset: a non-empty literal fallback
 * (`?? "x"`, `|| 3000`), a non-empty literal destructuring default, or a ternary on the variable itself. A fallback to another
 * env variable or any other expression, and a read inside a comparison or arithmetic, keeps the read required.
 */
export function extractEnvReads(source: string): Array<{ name: string; index: number; optional: boolean }> {
  const reads: Array<{ name: string; index: number; optional: boolean }> = [];
  // Comments are blanked (not removed), so every index still points into the original source.
  const code = stripComments(source);
  const access = new RegExp(ENV_ACCESS, "g");
  let match: RegExpExecArray | null;
  const operatorBefore = (index: number) => ENV_OPERATOR.exec(code.slice(Math.max(0, index - 200), index));
  while ((match = access.exec(code))) {
    const name = match[1] || match[2];
    const operator = operatorBefore(match.index);
    ENV_FALLBACK.lastIndex = access.lastIndex;
    const fallback = ENV_FALLBACK.exec(code);
    const test = ENV_TERNARY_TEST.exec(code.slice(Math.max(0, match.index - 200), match.index));
    const covered = fallback && (fallback[1] ? !operator : !operator || operator[1]);
    const guarded = test && (test[1] || test[2]) === name && !operatorBefore(match.index - test[0].length);
    reads.push({ name, index: match.index, optional: Boolean(covered || guarded) });
  }

  const destructure = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b(?!\s*(?:\?\.|\.|\[))/g;
  while ((match = destructure.exec(code))) {
    for (const part of match[1].split(",")) {
      const key = part.trim().replace(/^["']|["']?\s*(?::[\s\S]*|=[\s\S]*)?$/g, "").trim();
      if (!part.trim().startsWith("...") && ENV_NAME.test(key)) {
        reads.push({ name: key, index: match.index, optional: /^[^=]*=\s*(?:"(?!")|'(?!')|`(?!`)|-?\.?\d)/.test(part) });
      }
    }
  }
  return reads.sort((left, right) => left.index - right.index);
}

const LOCKFILES: Record<string, string> = {
  "package-lock.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};
const SUPPORTED_NODE_MAJORS = [20, 22, 24];

// Vite-based frameworks that render on the server and route requests themselves.
const VITE_SERVER_FRAMEWORKS = new Set(["@remix-run/dev", "@react-router/dev", "@sveltejs/kit", "nuxt", "astro", "@tanstack/react-start",
  "@tanstack/start", "@tanstack/solid-start", "vike", "vite-plugin-ssr", "@analogjs/platform", "@solidjs/start", "@builder.io/qwik-city", "waku"]);
const HISTORY_ROUTERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "BrowserRouter", pattern: /<BrowserRouter\b/ },
  { name: "createBrowserRouter", pattern: /\bcreateBrowserRouter\s*\(/ },
  { name: "createWebHistory", pattern: /\bcreateWebHistory\s*\(/ },
];

/** The first source file that sets up browser history routing, if any. Hash routing needs no rewrite. */
function historyRouter(snapshot: RepositorySnapshot) {
  for (const [file, source] of snapshot.contents) {
    if (!SOURCE_EXTENSION.test(file) || /(?:^|\/)node_modules\//.test(file)) continue;
    const code = stripComments(source);
    for (const router of HISTORY_ROUTERS) {
      const match = router.pattern.exec(code);
      if (match) return { file, line: lineAt(code, match.index), name: router.name };
    }
  }
  return undefined;
}

// Vercel's documented limits. Hobby only allows daily cron jobs (more often fails the deployment) and functions up to 300 s.
const MAX_CRON_JOBS = 100;
const HOBBY_MAX_DURATION = 300;

/**
 * crons and functions settings in vercel.json that fail on the Hobby plan, break Vercel's cron format or are ignored.
 * DeployDoctor cannot see the plan, so these stay warnings and say when only Hobby is affected.
 */
function vercelJsonFindings(raw: string, x: AnalysisText): Finding[] {
  let config: { crons?: unknown; functions?: unknown; fluid?: unknown } | null;
  try { config = JSON.parse(raw); } catch { return []; }
  if (!config || typeof config !== "object") return [];
  const findings: Finding[] = [];
  const at = (index: number) => Math.max(1, lineAt(raw, Math.max(0, index)));
  const finding = (index: number, problem: string, fix: string): Finding => ({ file: "vercel.json", line: at(index), problem, fix, command: "git add -- vercel.json" });

  if (Array.isArray(config.crons)) {
    const cronsAt = raw.indexOf('"crons"');
    if (config.crons.length > MAX_CRON_JOBS) findings.push(finding(cronsAt, x.build.cronCount(config.crons.length), x.build.cronCountFix));
    // The "schedule" keys after "crons", in order, give each job's line. Once one is missed, the rest use the crons line.
    const scheduleKey = /"schedule"\s*:/g;
    scheduleKey.lastIndex = Math.max(0, cronsAt);
    let scheduleAt: number | undefined = cronsAt;
    for (const job of config.crons) {
      if (!job || typeof job !== "object" || !("schedule" in job)) continue;
      scheduleAt = scheduleAt === undefined ? undefined : scheduleKey.exec(raw)?.index;
      const { schedule, path } = job as { schedule: unknown; path?: unknown };
      if (typeof schedule !== "string") continue;
      const shownPath = typeof path === "string" ? path : undefined;
      const parsed = parseVercelCron(schedule);
      if (parsed && "issue" in parsed) {
        findings.push(finding(scheduleAt ?? cronsAt, x.build.cronInvalid(schedule, x.build.cronReason(parsed.issue), shownPath), x.build.cronInvalidFix));
      } else if (parsed && runsMoreThanOnceADay(parsed)) {
        findings.push(finding(scheduleAt ?? cronsAt, x.build.cronHobby(schedule, shownPath), x.build.cronHobbyFix(dailyVersion(parsed))));
      }
    }
  }

  if (config.functions && typeof config.functions === "object" && !Array.isArray(config.functions)) {
    const functionsAt = raw.indexOf('"functions"');
    for (const [pattern, settings] of Object.entries(config.functions)) {
      if (!settings || typeof settings !== "object") continue;
      const patternAt = raw.indexOf(JSON.stringify(pattern), Math.max(0, functionsAt));
      const keyAt = (key: string) => patternAt === -1 ? functionsAt : Math.max(patternAt, raw.indexOf(`"${key}"`, patternAt));
      const { maxDuration, memory } = settings as { maxDuration?: unknown; memory?: unknown };
      if (typeof maxDuration === "number" && maxDuration > HOBBY_MAX_DURATION) {
        findings.push(finding(keyAt("maxDuration"), x.build.maxDuration(pattern, maxDuration), x.build.maxDurationFix));
      }
      // With Fluid compute (the default for new projects) memory in vercel.json is ignored with a build warning.
      if (memory !== undefined && config.fluid !== false) findings.push(finding(keyAt("memory"), x.build.memory(pattern), x.build.memoryFix));
    }
  }
  return findings;
}

type ConfigFile = { file: string; raw?: string; code?: string };

/** The root config file matching `pattern` with its comment-free code; only `file` when it exists but was not read. */
function rootConfig(snapshot: RepositorySnapshot, pattern: RegExp): ConfigFile | undefined {
  const file = snapshot.entries.filter((entry) => entry.type === "blob" && pattern.test(entry.path)).map((entry) => entry.path).sort()[0];
  const raw = file === undefined ? undefined : snapshot.contents.get(file);
  return file === undefined ? undefined : raw === undefined ? { file } : { file, raw, code: stripComments(raw) };
}

/** Where the module exports `name` (a function, a variable or an export list entry), or -1. */
function exportIndex(code: string, name: string): number {
  return code.search(new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s*\\*?\\s*${name}\\b|\\bexport\\s+(?:const|let|var)\\s+${name}\\b|\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`));
}
const exportsName = (code: string, name: string) => exportIndex(code, name) !== -1;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The literal right of `export const name =`, without quotes or a trailing as const, or undefined. */
function segmentConfig(code: string, name: string): { value: string; index: number } | undefined {
  const match = new RegExp(`\\bexport\\s+const\\s+${name}\\s*=\\s*([^;\\n]+)`).exec(code);
  return match ? { value: match[1].trim().replace(/\s+(?:as|satisfies)\s+[\w$.]+$/, "").replace(/^(["'`])(.*)\1$/, "$2"), index: match.index } : undefined;
}

/** export * from hides which names the module exports. */
const reexportsAll = (code: string) => /\bexport\s*\*\s*from\b/.test(code);

/**
 * Whether next.config exports a plain object literal, directly or through a variable it declares once, with no spread at
 * its top level. A plugin call, a function or a spread can add options when Next.js loads the config.
 */
function plainConfigObject(code: string): boolean {
  const exported = [...code.matchAll(/\bexport\s+default\s+|\bmodule\.exports\s*=(?!=)\s*/g)];
  if (exported.length !== 1) return false;
  let start = exported[0].index + exported[0][0].length;
  const name = /^([A-Za-z_$][\w$]*)(?:\s+(?:as|satisfies)\s+[\w$.]+)?\s*(?:;|\n|$)/.exec(code.slice(start))?.[1];
  if (name) {
    // Declared once and never reassigned, as in nextConfig = withMDX(nextConfig).
    const assignments = [...code.matchAll(new RegExp(`(?<![\\w$.])${escapeRegex(name)}\\s*(?::[^=;]+)?=(?![=>])\\s*`, "g"))];
    if (assignments.length !== 1 || !/\b(?:const|let|var)\s+$/.test(code.slice(0, assignments[0].index))) return false;
    start = assignments[0].index + assignments[0][0].length;
  }
  if (code[start] !== "{") return false;
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === '"' || char === "'" || char === "`") {
      for (index += 1; index < code.length && code[index] !== char; index += code[index] === "\\" ? 2 : 1);
    } else if ("{[(".includes(char)) depth += 1;
    else if ("}])".includes(char) && --depth === 0) return true;
    else if (depth === 1 && code.startsWith("...", index)) return false;
  }
  return true;
}

const NEXT_CONFIG = /^next\.config\.[cm]?[jt]s$/;
const APP_FILE = /^((?:src\/)?app)\/(?:(.*)\/)?(page|layout|route)\.[cm]?[jt]sx?$/;
const PAGES_FILE = /^(?:src\/)?pages\/(.+)\.[cm]?[jt]sx?$/;
const NOT_GET_METHODS = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
// Vercel runs the build script for these, so the script is the command that counts.
const RUNS_BUILD_SCRIPT = /^\s*(?:(?:npm|bun)\s+run|pnpm(?:\s+run)?|yarn(?:\s+run)?)\s+build\s*$/;

/** Folders below the root with their own package.json or next.config: another app, built with its own settings. */
function nestedProjects(snapshot: RepositorySnapshot): (file: string) => boolean {
  const dirs = [...new Set(snapshot.entries.map((entry) => /^(.+)\/(?:package\.json|next\.config\.[cm]?[jt]s)$/.exec(entry.path)?.[1]))]
    .filter((dir): dir is string => dir !== undefined);
  return (file) => dirs.some((dir) => file.startsWith(`${dir}/`));
}

// Plugins that set a turbopack option when the config loads under Next.js 16 (@next/mdx 16, nextra 4), read from their sources.
const TURBOPACK_PLUGINS = /["'](?:@next\/mdx|nextra)["']/;
// Plugins that add a webpack function and no turbopack option, so Next.js 16 stops even when next.config itself has no webpack function.
const WEBPACK_ONLY_PLUGINS = /["'](next-pwa|@ducanh2912\/next-pwa|@serwist\/next)["']/;

/**
 * Next.js 16 builds with Turbopack by default and stops when the loaded config has a webpack function and no turbopack
 * option, unless the build command picks a bundler with a flag or TURBOPACK or NEXT_RSPACK. Next.js checks the config
 * after plugins run, and some, such as @next/mdx and next-intl, add a turbopack option then, so only a plain object is red.
 */
function webpackFindings(config: ConfigFile | undefined, buildCommand: string, nextVersion: string | undefined, x: AnalysisText, red: Set<Finding>): Finding[] {
  const major = Number(/\d+/.exec(nextVersion ?? "")?.[0]);
  // A turbopack key, quoted or shorthand, an assignment, or the experimental.turbo keys Next.js also counts.
  if (!config?.code || !(major >= 16) || /\bturbo\w*["'`]?\s*:|[{,]\s*turbopack\s*(?=[,}])|\.turbopack\s*=(?!=)/.test(config.code)) return [];
  // TURBOPACK=auto is what Next.js sets when nothing picks a bundler, so only that value still fails.
  if (!/\bnext\s+build\b/.test(buildCommand) || /--(?:webpack|turbopack|turbo)\b|\bTURBOPACK=(?!["']?auto\b)["']?\w|\bNEXT_RSPACK=["']?\w/.test(buildCommand)) return [];
  // Only a function counts: plugin options such as Sentry's webpack: { ... } are objects, not a webpack config.
  const match = /(?:^|[{,\s])webpack\s*(?:\(|:\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>))|\.webpack\s*=(?!=)/m.exec(config.code);
  const webpackOnly = WEBPACK_ONLY_PLUGINS.exec(config.code);
  if (!match && !webpackOnly) return [];
  // These plugins add a turbopack option when the config loads, so Next.js sees both and builds.
  if (TURBOPACK_PLUGINS.test(config.code)) return [];
  if (webpackOnly) {
    const item: Finding = { file: config.file, line: lineAt(config.raw!, webpackOnly.index), problem: x.build.webpackOnlyPlugin(webpackOnly[1], major), fix: x.build.webpackOnlyPluginFix };
    red.add(item);
    return [item];
  }
  const line = lineAt(config.raw!, match!.index + match![0].indexOf("webpack"));
  if (!plainConfigObject(config.code)) return [{ file: config.file, line, problem: x.build.webpackPlugin(major), fix: x.build.webpackPluginFix }];
  const item: Finding = { file: config.file, line, problem: x.build.webpack(major), fix: x.build.webpackFix };
  red.add(item);
  return [item];
}

/**
 * With output set to export, the features the Next.js static exports guide lists as unsupported. A dynamic route without
 * generateStaticParams and a GET route handler not marked static stop next build (Next.js errors E1452 and E301); the
 * rest are warnings. Server Actions stay a warning: next build only fails for actions the app imports, which a scan of
 * the text cannot tell. Rewrites, redirects, headers and the default image loader are left out: Next.js skips those
 * warnings on Vercel.
 */
function staticExportFindings(snapshot: RepositorySnapshot, config: ConfigFile | undefined, nextVersion: string | undefined, x: AnalysisText, red: Set<Finding>): Finding[] {
  if (!config?.code || !/\boutput\s*:\s*["'`]export["'`]/.test(config.code)) return [];
  const findings: Finding[] = [];
  const nested = nestedProjects(snapshot);
  const files = snapshot.entries.filter((entry) => entry.type === "blob" && SOURCE_EXTENSION.test(entry.path) && !TEST_FILE.test(entry.path)
    && !/(?:^|\/)node_modules\//.test(entry.path) && !nested(entry.path)).map((entry) => entry.path).sort();
  const codeOf = (file: string) => { const raw = snapshot.contents.get(file); return raw === undefined ? undefined : stripComments(raw); };
  const finding = (file: string, index: number, problem: string, fix: string): Finding =>
    ({ file, line: Math.max(1, lineAt(snapshot.contents.get(file) ?? "", Math.max(0, index))), problem, fix });
  // Next.js reads middleware, and from Next.js 16 proxy, next to the pages or app folder it builds: at the root or in src.
  const hasDir = (dir: string) => snapshot.entries.some((entry) => entry.path.startsWith(`${dir}/`));
  const base = (["pages", "src/pages"].find(hasDir) ?? ["app", "src/app"].find(hasDir) ?? "").startsWith("src/") ? "src/" : "";
  // Next.js looks for them with its page extensions only (js, jsx, ts, tsx), so a .mjs or .cjs file of that name is not loaded.
  const requestFile = new RegExp(`^${base}(?:middleware${Number(/\d+/.exec(nextVersion ?? "")?.[0]) >= 16 ? "|proxy" : ""})\\.[jt]sx?$`);

  for (const file of files) {
    if (requestFile.test(file)) { findings.push(finding(file, 0, x.build.exportProxy, x.build.exportProxyFix)); continue; }
    const code = codeOf(file);
    if (code === undefined) continue;
    const match = APP_FILE.exec(file);
    const segments = (match?.[2] ?? "").split("/").filter(Boolean);
    // Folders that start with an underscore are private: Next.js routes nothing inside them.
    const app = match && !segments.some((segment) => segment.startsWith("_")) ? match : null;
    const pages = app ? null : PAGES_FILE.exec(file);
    let dynamicRoute = false;
    if ((app?.[3] === "page" || app?.[3] === "route") && segments.some((segment) => /^\[.+\]$/.test(segment))) {
      // A page takes generateStaticParams from itself or any layout above it, and an unread layout might hold it.
      // A route handler only from its own file. export * hides what a file exports.
      const directory = path.posix.dirname(file);
      const layouts = app[3] === "route" ? [] : files.filter((other) => { const dir = /^(.*)\/layout\.[cm]?[jt]sx?$/.exec(other)?.[1]; return dir !== undefined && (directory === dir || directory.startsWith(`${dir}/`)); });
      const sources = [code, ...layouts.map(codeOf)];
      if (sources.every((source) => source !== undefined && !reexportsAll(source) && !exportsName(source, "generateStaticParams"))) {
        const route = `/${segments.filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("@")).join("/")}`;
        const item = app[3] === "page"
          ? finding(file, code.search(/\bexport\s+default\b/), x.build.exportDynamic(route), x.build.exportDynamicFix)
          : finding(file, code.search(/\bexport\b/), x.build.exportDynamic(route), x.build.exportDynamicRouteFix);
        red.add(item);
        findings.push(item);
        dynamicRoute = true;
      }
    }
    if (app?.[3] === "route") {
      const methods = NOT_GET_METHODS.filter((method) => exportsName(code, method));
      if (methods.length) findings.push(finding(file, exportIndex(code, methods[0]), x.build.exportRouteMethods(methods.join(", ")), x.build.exportRouteMethodsFix));
      // The markers Next.js accepts as static (isStaticGenEnabled): dynamic force-static or error, revalidate other than 0, or generateStaticParams.
      const dynamic = segmentConfig(code, "dynamic")?.value;
      const revalidate = segmentConfig(code, "revalidate")?.value;
      const isStatic = dynamic === "force-static" || dynamic === "error" || (revalidate !== undefined && revalidate !== "0") || exportsName(code, "generateStaticParams");
      // A marker that comes from another file cannot be read. The dynamic route finding already covers its own GET.
      const unread = reexportsAll(code) || (dynamic === undefined && exportsName(code, "dynamic")) || (revalidate === undefined && exportsName(code, "revalidate"));
      if (exportsName(code, "GET") && !isStatic && !unread && !dynamicRoute) {
        const item = finding(file, exportIndex(code, "GET"), x.build.exportRouteStatic, x.build.exportRouteStaticFix);
        red.add(item);
        findings.push(item);
      }
    } else if (app) {
      const revalidate = segmentConfig(code, "revalidate");
      if (revalidate && /^\d+$/.test(revalidate.value) && Number(revalidate.value) > 0) {
        findings.push(finding(file, revalidate.index, x.build.exportIsr(Number(revalidate.value)), x.build.exportIsrFix));
      }
    } else if (pages && pages[1].startsWith("api/")) {
      findings.push(finding(file, 0, x.build.exportApiRoute, x.build.exportApiRouteFix));
    } else if (pages && exportsName(code, "getServerSideProps")) {
      // next build stops: pages with getServerSideProps can not be exported.
      const item = finding(file, exportIndex(code, "getServerSideProps"), x.build.exportGssp, x.build.exportGsspFix);
      red.add(item);
      findings.push(item);
    } else if (pages && exportsName(code, "getStaticProps")) {
      const revalidate = /\brevalidate\s*:\s*(\d+)/.exec(code);
      if (revalidate && Number(revalidate[1]) > 0) findings.push(finding(file, revalidate.index, x.build.exportIsr(Number(revalidate[1])), x.build.exportIsrFix));
    }
    const action = /^\s*(["'])use server\1\s*;?\s*$/m.exec(code);
    if (action) findings.push(finding(file, action.index + action[0].indexOf("use server") - 1, x.build.exportAction, x.build.exportActionFix));
  }
  return findings;
}

/** The hosts next.config allows for remote images, or null when it uses a custom loader, unoptimized or patterns it computes. */
function remoteImageHosts(code: string): { hosts: string[]; svg: boolean } | null {
  if (/\bunoptimized\s*:\s*true\b|\bloaderFile\s*:/.test(code)) return null;
  // images set from a variable, spread or changed after the object literal cannot be read. Strings are blanked first,
  // so a host such as images.example.com is not mistaken for code.
  const structure = code.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  if (/\bimages\s*:(?!\s*\{)|[{,]\s*images\s*[,}]|\bimages\s*\.\s*\w|\bimages\s*:\s*\{\s*\.\.\.|\bremotePatterns\b(?!\s*:)/.test(structure)) return null;
  const loader = /\bloader\s*:\s*([^,}\n]+)/.exec(code)?.[1].trim();
  if (loader !== undefined && !/^(["'`])default\1$/.test(loader)) return null;
  const hosts: string[] = [];
  for (const key of ["remotePatterns", "domains"]) {
    for (const match of code.matchAll(new RegExp(`\\b${key}\\s*:\\s*`, "g"))) {
      const start = match.index + match[0].length;
      if (code[start] !== "[") return null;
      let depth = 0;
      let end = start;
      for (; end < code.length; end += 1) {
        if (code[end] === "[") depth += 1;
        else if (code[end] === "]" && --depth === 0) break;
      }
      const list = code.slice(start + 1, end);
      if (/\.\.\.|\$\{|process\.env/.test(list)) return null;
      if (key === "domains") {
        if (list.replace(/(["'`])[^"'`]*\1/g, "").replace(/[\s,]/g, "")) return null;
        hosts.push(...[...list.matchAll(/(["'`])([^"'`]*)\1/g)].map((item) => item[2]));
        continue;
      }
      const named = [...list.matchAll(/\bhostname\s*:\s*(["'`])([^"'`]+)\1/g)].map((item) => item[2]);
      const urls = [...list.matchAll(/\bnew\s+URL\(\s*(["'`])([^"'`]+)\1/g)].map((item) => /^[a-z][\w+.-]*:\/\/([^/:?#]+)/i.exec(item[2])?.[1]);
      // Every hostname and URL must be a literal, or the list cannot be read.
      if (named.length !== (list.match(/\bhostname\s*:/g) ?? []).length || urls.length !== (list.match(/\bnew\s+URL\(/g) ?? []).length || urls.some((host) => !host)) return null;
      hosts.push(...named, ...(urls as string[]));
    }
  }
  return { hosts, svg: /\bdangerouslyAllowSVG\s*:\s*true\b/.test(code) };
}

/** Wildcards are read generously: * and ** match any characters, and **.example.com also covers example.com. */
function hostAllowed(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const lower = pattern.toLowerCase();
    const regex = new RegExp(`^${lower.split(/\*+/).map(escapeRegex).join(".*")}$`);
    return regex.test(host) || (lower.startsWith("**.") && host === lower.slice(3));
  });
}

/** The tag text from `<` to its closing `>`, skipping `>` inside strings and `{}` expressions such as arrow functions. */
function jsxTag(code: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  const limit = Math.min(code.length, start + 4000);
  for (let index = start + 1; index < limit; index += 1) {
    const char = code[index];
    if (quote) { if (char === quote) quote = null; }
    else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return code.slice(start, index + 1);
  }
  return code.slice(start, limit);
}

/** A next/image whose src is a literal remote URL on a host next.config does not allow. */
function remoteImageFindings(snapshot: RepositorySnapshot, config: ConfigFile | undefined, x: AnalysisText): Finding[] {
  // Without a next.config no remote host is allowed; a next.config that was not read could allow any.
  if (config && config.code === undefined) return [];
  const allowed = remoteImageHosts(config?.code ?? "");
  if (!allowed) return [];
  const findings: Finding[] = [];
  // An app in a subfolder with its own next.config or package.json is built with its own image settings.
  const nested = nestedProjects(snapshot);
  for (const [file, raw] of snapshot.contents) {
    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file) || /(?:^|\/)node_modules\//.test(file) || !raw.includes("next/") || nested(file)) continue;
    const code = stripComments(raw);
    for (const imported of code.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']next\/(?:legacy\/)?image["']/g)) {
      for (const tag of code.matchAll(new RegExp(`<${escapeRegex(imported[1])}(?=[\\s/>])`, "g"))) {
        const text = jsxTag(code, tag.index);
        // A spread, a custom loader or unoptimized (other than ={false}) can change what the optimizer gets.
        if (/\{\s*\.\.\./.test(text) || /(?<![\w.-])loader\s*=/.test(text) || /(?<![\w.-])unoptimized\b(?!\s*=\s*\{\s*false\s*\})/.test(text)) continue;
        const src = /(?<![\w.-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/.exec(text);
        const value = src?.slice(1).find((group) => group !== undefined);
        if (!src || !value || !/^https?:\/\//i.test(value)) continue;
        let url: URL;
        try { url = new URL(value); } catch { continue; }
        // next/image serves .svg files as they are unless dangerouslyAllowSVG is set.
        if ((url.pathname.toLowerCase().endsWith(".svg") && !allowed.svg) || hostAllowed(url.hostname, allowed.hosts)) continue;
        findings.push({ file, line: lineAt(raw, tag.index + src.index), problem: x.build.remoteImage(value, url.hostname), fix: x.build.remoteImageFix(url.hostname) });
      }
    }
  }
  return findings;
}

const SVELTE_ADAPTER = /["']@sveltejs\/adapter-(node|netlify|cloudflare-workers|cloudflare|bun|vercel|auto|static)["']/g;

/** A SvelteKit adapter built for another platform. adapter-auto picks adapter-vercel on Vercel, and adapter-static has zero-config support there. */
function svelteKitFindings(snapshot: RepositorySnapshot, x: AnalysisText): Finding[] {
  // SvelteKit 3 reads the adapter from vite.config; earlier versions from svelte.config.
  for (const pattern of [/^svelte\.config\.[cm]?[jt]s$/, /^vite\.config\.[cm]?[jt]s$/]) {
    const config = rootConfig(snapshot, pattern);
    const adapters = config?.code ? [...config.code.matchAll(SVELTE_ADAPTER)] : [];
    if (!adapters.length) continue;
    // A config that also imports a Vercel-ready adapter probably picks one per platform.
    if (adapters.some((match) => ["vercel", "auto", "static"].includes(match[1]))) return [];
    const name = adapters[0][1];
    return [{ file: config!.file, line: lineAt(config!.raw!, adapters[0].index), problem: x.build.svelteAdapter(`@sveltejs/adapter-${name}`, x.build.svelteTargets[name]),
      fix: x.build.svelteAdapterFix(config!.file) }];
  }
  return [];
}

/** Astro renders on demand only through an adapter: none stops astro build, and another platform's adapter is not what Vercel deploys. */
function astroFindings(snapshot: RepositorySnapshot, astroVersion: string | undefined, x: AnalysisText, red: Set<Finding>): Finding[] {
  const config = rootConfig(snapshot, /^astro\.config\.[cm]?[jt]s$/);
  const code = config ? config.code : "";
  if (code === undefined) return [];
  // The adapter key, written out or as the shorthand `adapter,` of an imported value.
  const adapter = /\badapter\s*[:,}]/.exec(code);
  // A config spread from elsewhere could set the adapter where we cannot see it; one in view still says which it is.
  if (!adapter && code.includes("...")) return [];
  // Astro 5 removed hybrid (static now covers it), so there hybrid fails config validation instead of needing an adapter.
  const astro4 = Number(/\d+/.exec(astroVersion ?? "")?.[0]) <= 4;
  const output = (astro4 ? /\boutput\s*:\s*["'`](server|hybrid)["'`]/ : /\boutput\s*:\s*["'`](server)["'`]/).exec(code);
  // Astro 4 builds a static site whole and ignores prerender false there; from Astro 5 the route renders on demand.
  const prerender = output || astro4 ? undefined : [...snapshot.contents].filter(([file]) => /^src\/pages\//.test(file) && (SOURCE_EXTENSION.test(file) || /\.astro$/i.test(file)))
    .map(([file, raw]) => ({ file, raw, match: /^\s*export\s+const\s+prerender\s*=\s*false\b/m.exec(stripComments(raw)) })).find((item) => item.match);
  if (!output && !prerender) return [];
  if (!adapter) {
    const item: Finding = output
      ? { file: config!.file, line: lineAt(config!.raw!, output.index), problem: x.build.astroOutputNoAdapter(output[1]), fix: x.build.astroNoAdapterFix }
      : { file: prerender!.file, line: lineAt(prerender!.raw, prerender!.match!.index + prerender!.match![0].indexOf("export")), problem: x.build.astroPrerenderNoAdapter, fix: x.build.astroNoAdapterFix };
    red.add(item);
    return [item];
  }
  const other = /["'](@astrojs\/(?:node|netlify|cloudflare))(?:\/[\w-]+)?["']/.exec(code)?.[1];
  if (!other || /["']@astrojs\/vercel(?:\/[\w-]+)?["']/.test(code)) return [];
  return [{ file: config!.file, line: lineAt(config!.raw!, adapter.index), problem: x.build.astroOtherAdapter(other), fix: x.build.astroOtherAdapterFix(other) }];
}

function checkBuildConfig(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const title = x.titles.buildConfig;
  const manifest = parsePackageJson(snapshot);
  const raw = snapshot.contents.get("package.json") ?? "";
  const lineOf = (needle: string) => Math.max(1, lineAt(raw, Math.max(0, raw.indexOf(needle))));
  const findings: Finding[] = [];

  const lockfiles = snapshot.entries.filter((entry) => entry.type === "blob" && entry.path in LOCKFILES).map((entry) => entry.path).sort();
  const managers = new Set(lockfiles.map((file) => LOCKFILES[file]));
  if (managers.size > 1) {
    const keep = manifest?.packageManager?.split("@")[0];
    const extra = lockfiles.filter((file) => LOCKFILES[file] !== keep);
    findings.push({ file: lockfiles[0], line: 1, problem: x.build.lockfiles(lockfiles.join(", ")),
      fix: x.build.lockfilesFix(keep && managers.has(keep) ? keep : undefined, lockfiles),
      ...(keep && managers.has(keep) ? { command: `git rm -- ${extra.map(shellQuote).join(" ")}` } : {}) });
  }

  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  // vercel.json can set its own build command; workspaces roots usually build through a workspace package.
  const vercelBuild = /"buildCommand"\s*:/.test(snapshot.contents.get("vercel.json") ?? "");
  if (manifest && packages.next && !manifest.scripts?.build && !vercelBuild && !manifest.workspaces) {
    findings.push({ file: "package.json", line: lineOf('"scripts"'), problem: x.build.noBuild, fix: x.build.noBuildFix,
      command: "git add -- package.json" });
  }

  const node = manifest?.engines?.node;
  if (typeof node === "string" && nodeRangeAllowsMajor(node, SUPPORTED_NODE_MAJORS) === false) {
    findings.push({ file: "package.json", line: lineOf('"engines"'), problem: x.build.engines(node), fix: x.build.enginesFix,
      command: "git add -- package.json" });
  }

  // A framework other than nextjs in vercel.json makes Vercel serve a Next.js app as something else:
  // the build passes and every URL returns 404 NOT_FOUND. null means the Other preset.
  const vercelRaw = snapshot.contents.get("vercel.json");
  if (vercelRaw && packages.next) {
    let framework: unknown;
    try { framework = (JSON.parse(vercelRaw) as { framework?: unknown }).framework; } catch { framework = undefined; }
    if (framework !== undefined && framework !== "nextjs") {
      const shown = framework === null ? "null" : String(framework);
      findings.push({ file: "vercel.json", line: Math.max(1, lineAt(vercelRaw, Math.max(0, vercelRaw.indexOf('"framework"')))),
        problem: x.build.framework(shown), fix: x.build.frameworkFix, command: "git add -- vercel.json" });
    }
  }
  if (vercelRaw) findings.push(...vercelJsonFindings(vercelRaw, x));

  // A Vite single page app with a history router needs a catch-all rewrite, or every deep link is a 404 on Vercel.
  const router = !packages.next && packages.vite && !Object.keys(packages).some((name) => VITE_SERVER_FRAMEWORKS.has(name))
    && !/"(?:rewrites|routes)"\s*:/.test(vercelRaw ?? "") && !snapshot.entries.some((entry) => /^vercel\.[cm]?[jt]s$/.test(entry.path))
    ? historyRouter(snapshot) : undefined;
  if (router) {
    findings.push({ file: router.file, line: router.line, problem: x.build.spaRewrite(router.name), fix: x.build.spaRewriteFix,
      ...(vercelRaw === undefined ? { command: `printf '%s\\n' '{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }' > vercel.json && git add -- vercel.json` } : {}) });
  }

  // Static sites: Vercel serves index.html for /, and Linux file names are case-sensitive.
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  if (!packages.next && !files.has("index.html")) {
    const wrongCase = [...files].find((file) => /^index\.html?$/i.test(file) && file !== "index.html");
    if (wrongCase) findings.push({ file: wrongCase, line: 1, problem: x.build.indexCase(wrongCase), fix: x.build.indexCaseFix(wrongCase),
      command: `git mv ${shellQuote(wrongCase)} tmp-index.html && git mv tmp-index.html index.html` });
  }

  // Findings the docs say stop the build; everything else here stays a warning.
  const red = new Set<Finding>();
  if (packages.next) {
    const nextConfig = rootConfig(snapshot, NEXT_CONFIG);
    let vercelBuildCommand: unknown;
    try { vercelBuildCommand = vercelRaw ? (JSON.parse(vercelRaw) as { buildCommand?: unknown }).buildCommand : undefined; } catch { vercelBuildCommand = undefined; }
    const configured = typeof vercelBuildCommand === "string" ? vercelBuildCommand : undefined;
    const buildCommand = configured !== undefined && !RUNS_BUILD_SCRIPT.test(configured) ? configured : manifest?.scripts?.build ?? (configured === undefined ? "next build" : "");
    findings.push(...webpackFindings(nextConfig, buildCommand, packages.next, x, red), ...staticExportFindings(snapshot, nextConfig, packages.next, x, red),
      ...remoteImageFindings(snapshot, nextConfig, x));
  }
  const framework = packages.next ? undefined : packages["@sveltejs/kit"] ? "SvelteKit" : packages.astro ? "Astro" : undefined;
  if (framework === "SvelteKit") findings.push(...svelteKitFindings(snapshot, x));
  if (framework === "Astro") findings.push(...astroFindings(snapshot, packages.astro, x, red));

  if (findings.length) {
    const ordered = [...findings.filter((item) => red.has(item)), ...findings.filter((item) => !red.has(item))];
    const yellow = findings.length - red.size;
    return makeCheck("build-config", title, red.size ? "red" : "yellow",
      [red.size ? x.build.red(red.size) : "", yellow ? x.build.yellow(yellow) : ""].filter(Boolean).join(" "), ordered[0].fix,
      ordered.map((item) => `${item.file}:${item.line} → ${item.problem}`), ordered);
  }
  return makeCheck("build-config", title, "green", framework ? x.build.okAdapter(framework) : x.build.ok, x.noChange);
}

// Files Next.js builds from; everything they import (transitively, through local files) is part of the build.
const NEXT_BUILD_ENTRY = /^(?:src\/)?(?:app|pages)\/|^(?:src\/)?(?:middleware|proxy|instrumentation|instrumentation-client|mdx-components)\.[cm]?[jt]sx?$|^next\.config\.[cm]?[jt]s$/;
// Next.js resolves these itself, so they build without being installed.
const PROVIDED_BY_NEXT = new Set(["server-only", "client-only"]);
const NEEDS_INSTALL_SCRIPT = ["bcrypt", "better-sqlite3", "sqlite3", "canvas", "node-sass"];
const TEXT_LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];
const ADD_COMMAND: Record<string, string> = { npm: "npm install", pnpm: "pnpm add", yarn: "yarn add", bun: "bun add" };

type ImportTarget = { kind: "local"; path?: string } | { kind: "package"; name: string } | { kind: "other" };

/** Resolves an import the way the Next.js build would, as far as the repository tree can tell. */
function importResolver(snapshot: RepositorySnapshot) {
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const config = tsconfigAliases(snapshot.contents.get("tsconfig.json") ?? snapshot.contents.get("jsconfig.json") ?? "");
  const aliases = [...config.prefixes];
  if (!aliases.some((alias) => alias.prefix === "@/")) aliases.push({ prefix: "@/", targets: ["src/", ""] });
  aliases.sort((left, right) => right.prefix.length - left.prefix.length);
  const find = (base: string) => possibleImportTargets(base).find((candidate) => files.has(candidate));

  return (file: string, specifier: string): ImportTarget => {
    const clean = specifier.split(/[?#]/)[0];
    if (clean.startsWith("./") || clean.startsWith("../")) return { kind: "local", path: find(path.posix.join(path.posix.dirname(file), clean)) };
    for (const { prefix, targets } of aliases) {
      if (prefix.endsWith("/") ? clean.startsWith(prefix) : clean === prefix || clean.startsWith(`${prefix}/`)) {
        const rest = clean.slice(prefix.length);
        return { kind: "local", path: targets.map((target) => find(path.posix.join(target, rest))).find(Boolean) };
      }
    }
    if (config.baseUrl !== undefined) {
      // With baseUrl, `components/Button` can be a folder or file under baseUrl rather than a package.
      const first = path.posix.join(config.baseUrl, clean.split("/")[0]);
      const local = find(path.posix.join(config.baseUrl, clean));
      if (local || snapshot.entries.some((entry) => entry.path === first || entry.path.startsWith(`${first}.`))) return { kind: "local", path: local };
    }
    const name = packageName(clean);
    return name ? { kind: "package", name } : { kind: "other" };
  };
}

/** Packages imported by code that is part of the Next.js build, with the first place each is imported. */
function buildImportedPackages(snapshot: RepositorySnapshot) {
  const resolve = importResolver(snapshot);
  const queue = [...snapshot.contents.keys()].filter((file) => NEXT_BUILD_ENTRY.test(file) && SOURCE_EXTENSION.test(file) && !TEST_FILE.test(file));
  const seen = new Set(queue);
  const packages = new Map<string, { file: string; line: number; static: boolean }>();
  while (queue.length) {
    const file = queue.shift()!;
    const source = snapshot.contents.get(file);
    if (source === undefined || file.endsWith(".d.ts")) continue;
    for (const use of moduleImports(source)) {
      const target = resolve(file, use.specifier);
      if (target.kind === "local" && target.path && !seen.has(target.path) && SOURCE_EXTENSION.test(target.path) && !TEST_FILE.test(target.path)) {
        seen.add(target.path);
        queue.push(target.path);
      } else if (target.kind === "package") {
        const known = packages.get(target.name);
        if (!known || (!known.static && use.kind === "static")) packages.set(target.name, { file, line: use.line, static: use.kind === "static" });
      }
    }
  }
  return packages;
}

function checkDependencies(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const title = x.titles.dependencies;
  const manifest = parsePackageJson(snapshot);
  const findings: Array<Finding & { red: boolean }> = [];
  const lockfiles = snapshot.entries.filter((entry) => entry.type === "blob" && entry.path in LOCKFILES).map((entry) => entry.path);
  const manager = lockfiles.length === 1 ? LOCKFILES[lockfiles[0]] : "npm";
  const lockfile = lockfiles.length === 1 && TEXT_LOCKFILES.includes(lockfiles[0]) ? snapshot.contents.get(lockfiles[0]) : undefined;
  const commitFiles = ["package.json", ...(lockfiles.length === 1 ? lockfiles : [])].join(" ");

  // Missing packages: only for a single Next.js app at the root, where the build's entry points are known.
  const workspaces = Boolean(manifest?.workspaces) || snapshot.entries.some((entry) => entry.path === "pnpm-workspace.yaml");
  const tracesImports = Boolean(manifest && (manifest.dependencies?.next || manifest.devDependencies?.next) && !workspaces);
  if (manifest && tracesImports) {
    const declared = new Set([manifest.name, ...[manifest.dependencies, manifest.devDependencies, manifest.peerDependencies,
      manifest.optionalDependencies].flatMap((section) => Object.keys(section ?? {}))]);
    const nextConfig = [...snapshot.contents].filter(([file]) => /^next\.config\./.test(file)).map(([, source]) => source).join("\n");
    const config = tsconfigAliases(snapshot.contents.get("tsconfig.json") ?? snapshot.contents.get("jsconfig.json") ?? "");
    // Aliases defined in an extended tsconfig, or a bundler alias in next.config, could make a name local.
    const unknownAliases = config.extendsOther && !config.prefixes.length && config.baseUrl === undefined;
    for (const [name, use] of buildImportedPackages(snapshot)) {
      if (declared.has(name) || PROVIDED_BY_NEXT.has(name)) continue;
      const certain = use.static && lockfile !== undefined && !lockfileMentions(lockfile, name) && !unknownAliases
        && !nextConfig.includes(`"${name}`) && !nextConfig.includes(`'${name}`) && !nextConfig.includes(`\`${name}`);
      findings.push({ file: use.file, line: use.line, red: certain,
        problem: certain ? x.deps.missingRed(name) : x.deps.missingYellow(name),
        fix: x.deps.missingFix(name, `${ADD_COMMAND[manager]} ${name}`), command: `git add -- ${commitFiles}` });
    }
  }

  // Lockfile drift: pnpm installs with a frozen lockfile in CI and stops; npm rewrites the lockfile and carries on.
  // A custom installCommand in vercel.json may not use the frozen lockfile, so pnpm drift is then only a warning.
  let drifted = 0;
  const raw = snapshot.contents.get("package.json") ?? "";
  const pnpm = lockfiles[0] === "pnpm-lock.yaml";
  const driftRed = pnpm && !/"installCommand"\s*:/.test(snapshot.contents.get("vercel.json") ?? "");
  if (manifest && lockfile !== undefined && (pnpm || lockfiles[0] === "package-lock.json")) {
    const locked = pnpm ? pnpmRootSpecifiers(lockfile) : npmRootSpecifiers(lockfile);
    const ignore = new Set([...Object.keys(manifest.peerDependencies ?? {}),
      ...(pnpm ? [...pnpmOverrides(lockfile), ...Object.keys(manifest.pnpm?.overrides ?? {})] : [])]);
    for (const drift of locked ? specifierDrift(manifestSpecifiers(manifest), locked, ignore) : []) {
      const inManifest = drift.manifest !== undefined && raw.indexOf(`"${drift.name}"`) !== -1;
      findings.push({ file: inManifest ? "package.json" : lockfiles[0], red: driftRed,
        line: inManifest ? lineAt(raw, raw.indexOf(`"${drift.name}"`)) : 1,
        problem: drift.manifest !== undefined && drift.locked !== undefined ? x.deps.driftChanged(drift.name, drift.manifest, lockfiles[0], drift.locked)
          : drift.manifest !== undefined ? x.deps.driftAdded(drift.name, lockfiles[0]) : x.deps.driftRemoved(drift.name, lockfiles[0]),
        fix: pnpm ? x.deps.pnpmFix : x.deps.npmFix, command: `git add -- ${lockfiles[0]}` });
      drifted += 1;
    }
  }

  // A package-lock.json written on macOS or Windows can leave out the Linux binaries of native packages.
  const native = lockfiles[0] === "package-lock.json" && lockfile !== undefined ? npmMissingLinuxBinaries(lockfile) : [];
  for (const name of native) {
    const index = lockfile!.indexOf(`node_modules/${name}"`);
    findings.push({ file: "package-lock.json", line: index === -1 ? 1 : lineAt(lockfile!, index), red: false,
      problem: x.deps.nativeMissing(name), fix: x.deps.nativeFix, command: "git add -- package-lock.json" });
  }

  // pnpm 10 skips dependency install scripts unless allowed; these packages fetch or build their binary in one.
  const pnpmMajor = /^pnpm@(\d+)/.exec(manifest?.packageManager ?? "")?.[1];
  const settingsElsewhere = snapshot.entries.some((entry) => entry.path === "pnpm-workspace.yaml" || entry.path === ".npmrc")
    || raw.includes("dangerouslyAllowAllBuilds");
  const builds = manifest && pnpm && lockfile !== undefined && /^lockfileVersion:\s*'?9\./m.test(lockfile)
    && (pnpmMajor === undefined || Number(pnpmMajor) >= 10) && !settingsElsewhere
    ? NEEDS_INSTALL_SCRIPT.filter((name) => name in { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.devDependencies }
      && !manifest.pnpm?.onlyBuiltDependencies?.includes(name))
    : [];
  for (const name of builds) {
    findings.push({ file: "package.json", line: lineAt(raw, Math.max(0, raw.indexOf(`"${name}"`))), red: false,
      problem: x.deps.pnpmBuilds(name), fix: x.deps.pnpmBuildsFix(builds), command: "git add -- package.json pnpm-lock.yaml" });
  }

  const red = findings.filter((item) => item.red);
  const ordered: Finding[] = [...red, ...findings.filter((item) => !item.red)]
    .map((item) => ({ file: item.file, line: item.line, problem: item.problem, fix: item.fix, command: item.command }));
  if (ordered.length) {
    const missingRed = red.length - (driftRed ? drifted : 0);
    const otherYellow = ordered.length - red.length - (driftRed ? 0 : drifted) - native.length - builds.length;
    const explanation = [
      ...(red.length ? [missingRed ? x.deps.red(missingRed) : "", red.length > missingRed ? x.deps.pnpmRed(red.length - missingRed) : ""]
        : [otherYellow ? x.deps.yellow(otherYellow) : "", drifted ? (pnpm ? x.deps.pnpmYellow(drifted) : x.deps.npmYellow(drifted)) : ""]),
      native.length ? x.deps.nativeYellow(native.length) : "",
      builds.length ? x.deps.pnpmBuildsYellow(builds.length) : "",
    ].filter(Boolean).join(" ");
    return makeCheck("dependencies", title, red.length ? "red" : "yellow", explanation, ordered[0].fix,
      ordered.map((item) => `${item.file}:${item.line} → ${item.problem}`), ordered);
  }
  if (snapshot.partial) return makeCheck("dependencies", title, "yellow", x.deps.partial, partialFix(snapshot, x));
  return makeCheck("dependencies", title, "green", tracesImports ? x.deps.ok : x.deps.okNotTraced, x.noChange);
}

function checkEnvironment(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const declared = new Set<string>();
  const used = new Set<string>();
  // Read at least once without a literal fallback or a ternary check, so an unset value reaches the code as undefined.
  const required = new Set<string>();
  const exposed = new Set<string>();
  const locations = new Map<string, { file: string; line: number }>();

  // A template under another name (env.example, .env.sample) documents the variables but tools never find it.
  const hasExample = snapshot.entries.some((entry) => entry.path === ".env.example");
  const misnamed = hasExample ? undefined : [...snapshot.contents.keys()].find((file) => MISNAMED_ENV_TEMPLATE.test(file));

  for (const [file, source] of snapshot.contents) {
    if (/(?:^|\/)\.env(?:\..+)?$/.test(file) || file === misnamed) {
      // In a template, a commented-out assignment (`# LOG_LEVEL="info"`) is the usual way to document an
      // optional variable with a default. Asking for `LOG_LEVEL=` instead would set it to an empty string,
      // which breaks apps that validate it (an enum or a URL), so the commented form counts as documented.
      const template = file === misnamed || ENV_TEMPLATE_FILE.test(file);
      for (const line of source.split(/\r?\n/)) {
        const name = line.match(ENV_ASSIGNMENT)?.[1] ?? (template ? line.match(ENV_COMMENTED_ASSIGNMENT)?.[1] : undefined);
        if (name) declared.add(name);
      }
      continue;
    }

    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file)) continue;
    for (const { name, index, optional } of extractEnvReads(source)) {
      used.add(name);
      if (!locations.has(name)) locations.set(name, { file, line: lineAt(source, index) });
      // A required variable points at its first read without a fallback.
      if (!optional && !required.has(name)) { required.add(name); locations.set(name, { file, line: lineAt(source, index) }); }
      if (/^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|ADMIN|DATABASE_URL)/.test(name)) {
        exposed.add(name);
      }
    }
  }

  const missing = [...used].filter((name) => required.has(name) && !declared.has(name) && !isBuiltInEnv(name)).sort();
  // Every read has a literal fallback or a ternary check, so an unset variable cannot break the app: worth documenting, never red.
  const optional = [...used].filter((name) => !required.has(name) && !declared.has(name) && !isBuiltInEnv(name)).sort();
  const ignored = envExampleIgnoreRule(snapshot, [...used].some((name) => !isBuiltInEnv(name)));
  const evidence = [
    ...missing.map((name) => x.env.evidenceMissing(name)),
    ...[...exposed].map((name) => x.env.evidenceExposed(name)),
  ];
  const title = x.titles.env;
  const misnamedFinding: Finding[] = misnamed ? [{ file: misnamed, line: 1, problem: x.env.misnamedProblem(misnamed),
    fix: x.env.misnamedFix(misnamed), command: `git mv ${misnamed} .env.example` }] : [];
  const gitignoreFinding: Finding[] = ignored ? [{ file: ".gitignore", line: ignored.line, problem: x.env.gitignoreProblem(ignored.pattern),
    fix: x.env.gitignoreFix(ENV_EXAMPLE_EXCEPTION), command: "git add -- .gitignore .env.example" }] : [];
  const conventionEvidence = [...(misnamed ? [x.env.evidenceMisnamed(misnamed)] : []), ...(ignored ? [x.env.evidenceGitignore(ignored.pattern)] : [])];
  const conventionProblems = [misnamed ? x.env.misnamed(misnamed) : "", ignored ? x.env.gitignore(ignored.pattern) : ""].filter(Boolean);
  const conventionFixes = [misnamed ? x.env.misnamedFix(misnamed) : "", ignored ? x.env.gitignoreFix(ENV_EXAMPLE_EXCEPTION) : ""].filter(Boolean);
  const optionalProblem = optional.length ? x.env.optional(optional.length, optional.join(", ")) : "";
  const optionalFix = optional.length ? x.env.fixOptional(optional.map((name) => `# ${name}=`).join(" + ")) : "";
  const optionalEvidence = optional.map((name) => x.env.evidenceOptional(name));
  const optionalFindings: Finding[] = optional.map((name) => ({ ...locations.get(name)!, problem: x.env.optionalProblem(name),
    fix: x.env.optionalFix(name), command: "git add -- .env.example" }));
  const withEnvExample = (check: CheckResult) => {
    if (missing.length || optional.length) {
      const existing = snapshot.contents.get(".env.example") ?? (misnamed ? assignmentsOnly(snapshot.contents.get(misnamed) ?? "") : undefined);
      check.suggestedFile = { path: ".env.example", content: completeEnvExample(existing, missing, optional), command: "git add -- .env.example" };
    }
    return check;
  };

  if (evidence.length) {
    return withEnvExample(makeCheck("env", title, exposed.size ? "red" : "yellow",
      [missing.length ? x.env.missing(missing.length, missing.join(", ")) : "",
        exposed.size ? x.env.exposed(exposed.size, [...exposed].join(", ")) : "",
        ...conventionProblems, optionalProblem].filter(Boolean).join("; ") + ".",
      [...conventionFixes,
        missing.length ? x.env.fixMissing(missing.map((name) => `${name}=`).join(" + ")) : "",
        exposed.size ? x.env.fixExposed : "", optionalFix].filter(Boolean).join("; ") + ".",
      [...conventionEvidence, ...evidence, ...optionalEvidence],
      [...misnamedFinding, ...gitignoreFinding,
        ...missing.map((name) => ({ ...locations.get(name)!, problem: x.env.missingProblem(name),
          fix: x.env.missingFix(name), command: "git add -- .env.example" })),
        ...[...exposed].map((name) => ({ ...locations.get(name)!, problem: x.env.exposedProblem(name),
          fix: x.env.exposedFix(name.replace(/^NEXT_PUBLIC_/, "")) })),
        ...optionalFindings],
    ));
  }
  if (misnamed || ignored || optional.length) {
    return withEnvExample(makeCheck("env", title, "yellow", [...conventionProblems, optionalProblem].filter(Boolean).join("; ") + ".",
      [...conventionFixes, optionalFix].filter(Boolean).join("; ") + ".",
      [...conventionEvidence, ...optionalEvidence], [...misnamedFinding, ...gitignoreFinding, ...optionalFindings]));
  }
  if (snapshot.partial) return makeCheck("env", title, "yellow", x.env.partial, partialFix(snapshot, x));
  return makeCheck("env", title, "green", used.size ? x.env.okUsed : x.env.okNone, x.noChange);
}

/**
 * The committed .env.example plus an empty line for every missing variable and a commented one for every
 * optional variable (an empty value would replace its fallback). A value that looks like a real secret is
 * emptied, so the suggested file never repeats one (the secrets check reports it).
 */
function completeEnvExample(existing: string | undefined, missing: string[], optional: string[]): string {
  const text = (existing ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const lines = (text ? text.split("\n") : []).map((line) => findSecrets(line).length ? line.replace(/=.*$/, "=") : line);
  return [...lines, ...missing.map((name) => `${name}=`), ...optional.map((name) => `# ${name}=`)].join("\n") + "\n";
}

const ENV_EXAMPLE_EXCEPTION = "!.env.example";
const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
/** `# NAME=value` in a template. Upper-case names only, so prose such as `# note: a=b` is never read as a variable. */
const ENV_COMMENTED_ASSIGNMENT = /^\s*#\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;
/** Committed env templates (never a real .env), where commented assignments document optional variables. */
const ENV_TEMPLATE_FILE = /(?:^|\/)\.env\.(?:example|sample|template)$/;
/** Root files people name their env template when they do not know the convention. */
export const MISNAMED_ENV_TEMPLATE = /^(?:env\.example|env\.sample|env\.template|example\.env|sample\.env|template\.env|\.env\.sample|\.env\.template|\.env\.example\.txt)$/i;
/** Keeps the assignment and comment lines of a template written as prose or markdown, so the suggested file is a real dotenv file. */
function assignmentsOnly(source: string): string {
  return source.split(/\r?\n/).filter((line) => ENV_ASSIGNMENT.test(line) || /^\s*#/.test(line)).join("\n");
}

/**
 * The root .gitignore rule that would stop a new .env.example from being committed. Only reported when the
 * repository reads its own env variables and .env.example is not already tracked (tracked files stay tracked).
 */
function envExampleIgnoreRule(snapshot: RepositorySnapshot, readsCustomEnv: boolean) {
  const gitignore = snapshot.contents.get(".gitignore");
  if (!gitignore || !readsCustomEnv || snapshot.entries.some((entry) => entry.path === ".env.example")) return null;
  const rule = ignoringRule(gitignore, ".env.example");
  // Only report it when appending the exception line really fixes it.
  if (!rule || ignoringRule(`${gitignore}\n${ENV_EXAMPLE_EXCEPTION}\n`, ".env.example")) return null;
  return rule;
}

function checkSecrets(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const title = x.titles.secrets;
  const findings: Finding[] = [];
  for (const [file, source] of snapshot.contents) {
    if (TEST_FILE.test(file) || file in LOCKFILES) continue;
    for (const secret of findSecrets(source)) {
      findings.push({ file, line: lineAt(source, secret.index), problem: x.secrets.problem(x.secrets.kinds[secret.kind], secret.masked),
        fix: x.secrets.fix(x.secrets.kinds[secret.kind]) });
    }
  }
  if (findings.length) {
    return makeCheck("secrets", title, "red", x.secrets.red(findings.length), x.secrets.summaryFix,
      findings.map((item) => `${item.file}:${item.line} → ${item.problem}`), findings);
  }
  if (snapshot.partial) return makeCheck("secrets", title, "yellow", x.secrets.partial, partialFix(snapshot, x));
  return makeCheck("secrets", title, "green", x.secrets.ok, x.noChange);
}

function hasUseClient(source: string): boolean {
  return /^\s*["']use client["']\s*;?/.test(source);
}

function checkSupabase(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const violations = new Set<string>();
  const browserClient = /\bcreateBrowserClient\b|["'][^"']*supabase\/(?:client|browser)["']/;
  const serviceRole = /\b(?:NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET)[A-Z0-9_]*|SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY)\b/;

  for (const [file, source] of snapshot.contents) {
    if (!SOURCE_EXTENSION.test(file)) continue;
    const clientFile = hasUseClient(source);
    const serverContext = API_ROUTE.test(file) || (SERVER_COMPONENT.test(file) && !clientFile);

    if (serverContext && browserClient.test(source)) {
      violations.add(x.supabase.serverBrowser(file));
    }
    if (clientFile && serviceRole.test(source)) {
      violations.add(x.supabase.clientKey(file));
    }
  }

  // Migrations: replayed in order, only when every migration file was read (a gap could hide the grant or the RLS line).
  const migrations = snapshot.entries.filter((entry) => entry.type === "blob" && MIGRATION_FILE.test(entry.path)).map((entry) => entry.path).sort();
  const audit = migrations.length && migrations.every((file) => snapshot.contents.has(file))
    ? auditMigrations(migrations.map((file) => ({ file, source: snapshot.contents.get(file)! }))) : { tables: [], openPolicies: [] };
  const noRls: Finding[] = audit.tables.filter((table) => !table.rls).map((table) => ({ file: table.file, line: table.line,
    problem: x.supabase.rlsMissing(table.name), fix: x.supabase.rlsFix(table.name) }));
  const noGrant: Finding[] = audit.tables.filter((table) => !table.granted).map((table) => ({ file: table.file, line: table.line,
    problem: x.supabase.grantsMissing(table.name), fix: x.supabase.grantsFix(grantSql(table.name)) }));
  const open: Finding[] = audit.openPolicies.map((policy) => ({ file: policy.file, line: policy.line,
    problem: x.supabase.openPolicy(policy.policy, policy.table, policy.command), fix: x.supabase.openPolicyFix }));
  const findings = [...noRls, ...open, ...noGrant];

  const title = x.titles.supabase;
  const evidence = [...violations, ...findings.map((item) => `${item.file}:${item.line} → ${item.problem}`)];
  if (violations.size || noRls.length) {
    const explanation = [violations.size ? x.supabase.red : "", noRls.length ? x.supabase.rlsRed(noRls.length) : "",
      open.length ? x.supabase.openYellow(open.length) : "", noGrant.length ? x.supabase.grantsYellow(noGrant.length) : ""].filter(Boolean).join(" ");
    return makeCheck("supabase", title, "red", explanation, violations.size ? x.supabase.fix : noRls[0].fix, evidence, findings);
  }
  if (findings.length) {
    const explanation = [open.length ? x.supabase.openYellow(open.length) : "", noGrant.length ? x.supabase.grantsYellow(noGrant.length) : ""].filter(Boolean).join(" ");
    return makeCheck("supabase", title, "yellow", explanation, findings[0].fix, evidence, findings);
  }
  if (snapshot.partial) return makeCheck("supabase", title, "yellow", x.supabase.partial, partialFix(snapshot, x));
  return makeCheck("supabase", title, "green", x.supabase.ok, x.noChange);
}

function checkPrisma(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const title = x.titles.prisma;
  const manifest = parsePackageJson(snapshot);
  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const usesPrisma = "prisma" in packages || "@prisma/client" in packages;
  const usesDrizzle = "drizzle-orm" in packages || "drizzle-kit" in packages;

  if (!usesPrisma) return makeCheck("prisma", title, "green", usesDrizzle ? x.prisma.okDrizzle : x.prisma.okNone, x.noChange);

  const findings: Finding[] = [];
  const buildScripts = ["postinstall", "build", "vercel-build"].map((name) => manifest?.scripts?.[name] ?? "").join("\n");
  if (!/prisma\s+generate/.test(buildScripts)) {
    findings.push({ file: "package.json", line: 1, problem: x.prisma.noGenerate, fix: x.prisma.noGenerateFix, command: "git add -- package.json" });
  }
  for (const [file, source] of snapshot.contents) {
    if (!/\.prisma$/.test(file)) continue;
    const match = /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"sqlite"/.exec(source);
    if (match) findings.push({ file, line: lineAt(source, match.index), problem: x.prisma.sqlite, fix: x.prisma.sqliteFix });
  }

  if (findings.length) {
    return makeCheck("prisma", title, "red", x.prisma.red(findings.length), findings[0].fix,
      findings.map((item) => `${item.file}:${item.line} → ${item.problem}`), findings);
  }
  if (snapshot.partial) return makeCheck("prisma", title, "yellow", x.prisma.partial, partialFix(snapshot, x));
  return makeCheck("prisma", title, "green", x.prisma.ok, x.noChange);
}

/** "root" when the root package.json declares Next.js, "nested" when a subfolder looks like a Next.js app, else "none". */
export function locateNextApp(snapshot: RepositorySnapshot, stack: Stack): "root" | "nested" | "none" {
  if (stack.hasNext) return "root";
  const paths = new Set(snapshot.entries.filter((entry) => !/(?:^|\/)node_modules\//.test(entry.path)).map((entry) => entry.path));
  for (const path of paths) {
    const nested = /^(.+)\/(?:next\.config\.[cm]?[jt]s|package\.json)$/.exec(path);
    if (!nested) continue;
    const dir = nested[1];
    if (path.endsWith("next.config.js") || path.endsWith("next.config.mjs") || path.endsWith("next.config.cjs") || path.endsWith("next.config.ts")) return "nested";
    if (["app", "pages", "src/app", "src/pages"].some((folder) => paths.has(`${dir}/${folder}`))) return "nested";
  }
  return "none";
}

export function analyzeSnapshot(snapshot: RepositorySnapshot, options: { checks?: Category[]; lang?: Lang } = {}): ReportResults {
  const x = analysisText(options.lang ?? "en");
  const envText: string[] = [];
  const sources: string[] = [];
  for (const [file, source] of snapshot.contents) {
    if (/(?:^|\/)\.env(?:\..+)?$/.test(file)) envText.push(source);
    else if (SOURCE_EXTENSION.test(file)) sources.push(source);
  }
  const stack = detectStack({ packageJson: snapshot.contents.get("package.json"), envText: envText.join("\n"), sources });
  // Without an explicit choice, scan only what the detected stack needs.
  const chosen = new Set(options.checks ?? defaultChecks(stack));
  const runners: Record<Category, Array<(snapshot: RepositorySnapshot, x: AnalysisText) => CheckResult>> = {
    next: [checkNextEntrypoint, checkImports],
    vercel: [checkServerLibraries, checkBuildConfig, checkDependencies],
    env: [checkEnvironment, checkSecrets],
    supabase: [checkSupabase],
    prisma: [checkPrisma],
  };
  const scanned = CATEGORIES.filter((category) => chosen.has(category));
  const checks = scanned.flatMap((category) => runners[category].map((run) => run(snapshot, x)));
  const summary = checks.reduce<Record<CheckStatus, number>>(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { red: 0, yellow: 0, green: 0 },
  );

  return {
    repository: {
      owner: snapshot.owner,
      name: snapshot.name,
      defaultBranch: snapshot.defaultBranch,
    },
    checkedAt: new Date().toISOString(),
    scan: {
      filesInTree: snapshot.entries.filter((entry) => entry.type === "blob").length,
      sourceFilesFound: snapshot.sourceFilesFound,
      sourceFilesRead: snapshot.sourceFilesRead,
      partial: snapshot.partial,
      reasons: snapshot.partialReasons,
    },
    scope: { scanned, ignored: CATEGORIES.filter((category) => !chosen.has(category)) },
    stack,
    nextApp: locateNextApp(snapshot, stack),
    summary,
    overall: summary.red ? "red" : summary.yellow ? "yellow" : "green",
    checks,
  };
}
