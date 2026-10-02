import path from "node:path";
import type { Category, CheckResult, CheckStatus, ReportResults, Finding } from "@/types/report";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { defaultChecks, detectStack, type Stack } from "@/lib/stack";
import { analysisText, type AnalysisText } from "@/lib/analysis-text";
import type { Lang } from "@/lib/i18n";
import { ignoringRule } from "@/lib/gitignore";
import { nodeRangeAllowsMajor } from "@/lib/node-range";
import { findSecrets } from "@/lib/secrets";
import { lockfileMentions, manifestSpecifiers, moduleImports, npmRootSpecifiers, packageName, pnpmOverrides, pnpmRootSpecifiers, stripComments,
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

function isBuiltInEnv(name: string): boolean {
  return BUILT_IN_ENV.has(name) || VERCEL_SYSTEM_ENV.test(name);
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
      pnpm?: { overrides?: Record<string, string> };
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

function extractImports(source: string): Array<{ specifier: string; line: number }> {
  const imports = new Map<string, { specifier: string; line: number }>();
  const staticImport = /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  const callImport = /(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;

  for (const matcher of [staticImport, callImport]) {
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(source))) {
      const line = lineAt(source, match.index);
      imports.set(`${line}:${match[1]}`, { specifier: match[1], line });
    }
  }
  return [...imports.values()];
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

function aliasRoots(snapshot: RepositorySnapshot): string[] {
  const tsconfig = snapshot.contents.get("tsconfig.json") ?? snapshot.contents.get("jsconfig.json") ?? "";
  const mapped = tsconfig.match(/["']@\/\*["']\s*:\s*\[\s*["']([^"']+)\*["']/)?.[1];
  if (mapped) return [mapped.replace(/^\.\//, "").replace(/\/$/, "")];
  return ["src", ""];
}

/** Rebuilds `wanted` with the letter case of `actual` wherever the two only differ in case. */
function withCaseOf(wanted: string, actual: string): string {
  return [...wanted].map((char, index) => actual[index]?.toLowerCase() === char.toLowerCase() ? actual[index] : char).join("");
}

function checkImports(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  // Linux file systems (and so Vercel builds) are case-sensitive; macOS and Windows are not.
  const filesByLowerCase = new Map([...files].map((file) => [file.toLowerCase(), file]));
  const aliases = aliasRoots(snapshot);
  const missing: Finding[] = [];
  let caseMismatches = 0;

  for (const [file, source] of snapshot.contents) {
    // next-env.d.ts intentionally references generated .next type files that are gitignored.
    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file) || path.posix.basename(file) === "next-env.d.ts") continue;

    for (const { specifier: original, line } of extractImports(source)) {
      const specifier = original.split(/[?#]/)[0];
      let bases: Array<{ base: string; toSpecifier: (resolved: string) => string }> = [];
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const directory = path.posix.dirname(file);
        bases = [{ base: path.posix.join(directory, specifier), toSpecifier: (resolved) => {
          const relative = path.posix.relative(directory, resolved);
          return relative.startsWith("../") ? relative : `./${relative}`;
        } }];
      } else if (specifier.startsWith("@/")) {
        bases = aliases.map((root) => ({ base: path.posix.join(root, specifier.slice(2)),
          toSpecifier: (resolved: string) => `@/${root ? resolved.slice(root.length + 1) : resolved}` }));
      } else {
        continue;
      }
      const candidates = bases.flatMap(({ base }) => possibleImportTargets(base));

      if (!candidates.some((candidate) => files.has(candidate))) {
        const caseMatch = bases.flatMap(({ base, toSpecifier }) => possibleImportTargets(base).map((candidate) => ({
          base: path.posix.normalize(base).replace(/^\.\//, ""), toSpecifier, actual: filesByLowerCase.get(candidate.toLowerCase()) })))
          .find((item) => item.actual);
        if (caseMatch?.actual) {
          const exact = caseMatch.toSpecifier(withCaseOf(caseMatch.base, caseMatch.actual));
          missing.push({ file, line, problem: x.imports.caseProblem(original, caseMatch.actual), fix: x.imports.caseFix(exact, line) });
          caseMismatches += 1;
          continue;
        }
        const target = candidates[0];
        missing.push({ file, line, problem: x.imports.problem(original), fix: x.imports.fix(target, line),
          command: `git add -- ${shellQuote(target)}` });
      }
    }
  }

  if (missing.length) {
    return makeCheck(
      "imports",
      x.titles.imports,
      "red",
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
function runtimeImports(source: string): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];
  source.split("\n").forEach((text, index) => {
    if (/^\s*(?:\/\/|\/?\*)/.test(text)) return;
    const matchers = [/^\s*(?:import|export)\s+(type\s+)?(?:([^"'`;]*?)\s+from\s+)?["']([^"']+)["']/g,
      /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g];
    for (const match of text.matchAll(matchers[0])) {
      const clause = match[2] ?? "";
      const onlyTypes = /^\{\s*(?:type\s+[^,}]+,?\s*)+\}$/.test(clause.trim());
      if (!match[1] && !onlyTypes) found.push({ specifier: match[3], line: index + 1 });
    }
    for (const match of text.matchAll(matchers[1])) found.push({ specifier: match[1], line: index + 1 });
  });
  return found;
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
  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const riskyPackages = Object.keys(packages).filter((name) =>
    /^(?:playwright|playwright-core|@playwright\/test|puppeteer|puppeteer-core|sqlite3|better-sqlite3)$/.test(name),
  );
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

/** process.env.X, process.env?.X, process.env["X"], process.env?.["X"] and `const { X, Y: y = "" } = process.env`. */
export function extractEnvReads(source: string): Array<{ name: string; index: number }> {
  const reads: Array<{ name: string; index: number }> = [];
  // Comments are blanked (not removed), so every index still points into the original source.
  const code = stripComments(source);
  const access = /process\.env(?:\??\.([A-Z][A-Z0-9_]*)\b|(?:\?\.)?\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
  let match: RegExpExecArray | null;
  while ((match = access.exec(code))) reads.push({ name: match[1] || match[2], index: match.index });

  const destructure = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b(?!\s*(?:\?\.|\.|\[))/g;
  while ((match = destructure.exec(code))) {
    for (const part of match[1].split(",")) {
      const key = part.trim().replace(/^["']|["']?\s*(?::[\s\S]*|=[\s\S]*)?$/g, "").trim();
      if (!part.trim().startsWith("...") && ENV_NAME.test(key)) reads.push({ name: key, index: match.index });
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

  if (findings.length) {
    return makeCheck("build-config", title, "yellow", x.build.yellow(findings.length), findings[0].fix,
      findings.map((item) => `${item.file}:${item.line} → ${item.problem}`), findings);
  }
  return makeCheck("build-config", title, "green", x.build.ok, x.noChange);
}

// Files Next.js builds from; everything they import (transitively, through local files) is part of the build.
const NEXT_BUILD_ENTRY = /^(?:src\/)?(?:app|pages)\/|^(?:src\/)?(?:middleware|proxy|instrumentation|instrumentation-client|mdx-components)\.[cm]?[jt]sx?$|^next\.config\.[cm]?[jt]s$/;
// Next.js resolves these itself, so they build without being installed.
const PROVIDED_BY_NEXT = new Set(["server-only", "client-only"]);
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

  const red = findings.filter((item) => item.red);
  const ordered: Finding[] = [...red, ...findings.filter((item) => !item.red)]
    .map((item) => ({ file: item.file, line: item.line, problem: item.problem, fix: item.fix, command: item.command }));
  if (ordered.length) {
    const missingRed = red.length - (driftRed ? drifted : 0);
    const explanation = red.length
      ? [missingRed ? x.deps.red(missingRed) : "", red.length > missingRed ? x.deps.pnpmRed(red.length - missingRed) : ""].filter(Boolean).join(" ")
      : [ordered.length > drifted ? x.deps.yellow(ordered.length - drifted) : "",
        drifted ? (pnpm ? x.deps.pnpmYellow(drifted) : x.deps.npmYellow(drifted)) : ""].filter(Boolean).join(" ");
    return makeCheck("dependencies", title, red.length ? "red" : "yellow", explanation, ordered[0].fix,
      ordered.map((item) => `${item.file}:${item.line} → ${item.problem}`), ordered);
  }
  if (snapshot.partial) return makeCheck("dependencies", title, "yellow", x.deps.partial, partialFix(snapshot, x));
  return makeCheck("dependencies", title, "green", tracesImports ? x.deps.ok : x.deps.okNotTraced, x.noChange);
}

function checkEnvironment(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const declared = new Set<string>();
  const used = new Set<string>();
  const exposed = new Set<string>();
  const locations = new Map<string, { file: string; line: number }>();

  for (const [file, source] of snapshot.contents) {
    if (/(?:^|\/)\.env(?:\..+)?$/.test(file)) {
      for (const line of source.split(/\r?\n/)) {
        const name = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
        if (name) declared.add(name);
      }
      continue;
    }

    if (!SOURCE_EXTENSION.test(file) || TEST_FILE.test(file)) continue;
    for (const { name, index } of extractEnvReads(source)) {
      used.add(name);
      if (!locations.has(name)) locations.set(name, { file, line: lineAt(source, index) });
      if (/^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|ADMIN|DATABASE_URL)/.test(name)) {
        exposed.add(name);
      }
    }
  }

  const missing = [...used].filter((name) => !declared.has(name) && !isBuiltInEnv(name)).sort();
  const ignored = envExampleIgnoreRule(snapshot, [...used].some((name) => !isBuiltInEnv(name)));
  const evidence = [
    ...missing.map((name) => x.env.evidenceMissing(name)),
    ...[...exposed].map((name) => x.env.evidenceExposed(name)),
  ];
  const title = x.titles.env;
  const gitignoreFinding: Finding[] = ignored ? [{ file: ".gitignore", line: ignored.line, problem: x.env.gitignoreProblem(ignored.pattern),
    fix: x.env.gitignoreFix(ENV_EXAMPLE_EXCEPTION), command: "git add -- .gitignore .env.example" }] : [];

  if (evidence.length) {
    const check = makeCheck("env", title, "red",
      [missing.length ? x.env.missing(missing.length, missing.join(", ")) : "",
        exposed.size ? x.env.exposed(exposed.size, [...exposed].join(", ")) : "",
        ignored ? x.env.gitignore(ignored.pattern) : ""].filter(Boolean).join("; ") + ".",
      [ignored ? x.env.gitignoreFix(ENV_EXAMPLE_EXCEPTION) : "",
        missing.length ? x.env.fixMissing(missing.map((name) => `${name}=`).join(" + ")) : "",
        exposed.size ? x.env.fixExposed : ""].filter(Boolean).join("; ") + ".",
      [...(ignored ? [x.env.evidenceGitignore(ignored.pattern)] : []), ...evidence],
      [...gitignoreFinding,
        ...missing.map((name) => ({ ...locations.get(name)!, problem: x.env.missingProblem(name),
          fix: x.env.missingFix(name), command: "git add -- .env.example" })),
        ...[...exposed].map((name) => ({ ...locations.get(name)!, problem: x.env.exposedProblem(name),
          fix: x.env.exposedFix(name.replace(/^NEXT_PUBLIC_/, "")) }))],
    );
    if (missing.length) {
      check.suggestedFile = { path: ".env.example", content: completeEnvExample(snapshot.contents.get(".env.example"), missing),
        command: "git add -- .env.example" };
    }
    return check;
  }
  if (ignored) {
    return makeCheck("env", title, "yellow", x.env.gitignore(ignored.pattern) + ".", x.env.gitignoreFix(ENV_EXAMPLE_EXCEPTION),
      [x.env.evidenceGitignore(ignored.pattern)], gitignoreFinding);
  }
  if (snapshot.partial) return makeCheck("env", title, "yellow", x.env.partial, partialFix(snapshot, x));
  return makeCheck("env", title, "green", used.size ? x.env.okUsed : x.env.okNone, x.noChange);
}

/**
 * The committed .env.example plus an empty line for every missing variable. A value that looks like a
 * real secret is emptied, so the suggested file never repeats one (the secrets check reports it).
 */
function completeEnvExample(existing: string | undefined, missing: string[]): string {
  const text = (existing ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const lines = (text ? text.split("\n") : []).map((line) => findSecrets(line).length ? line.replace(/=.*$/, "=") : line);
  return [...lines, ...missing.map((name) => `${name}=`)].join("\n") + "\n";
}

const ENV_EXAMPLE_EXCEPTION = "!.env.example";

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

  const title = x.titles.supabase;
  if (violations.size) return makeCheck("supabase", title, "red", x.supabase.red, x.supabase.fix, [...violations]);
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
