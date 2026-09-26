import path from "node:path";
import type { Category, CheckResult, CheckStatus, ReportResults, Finding } from "@/types/report";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { defaultChecks, detectStack } from "@/lib/stack";
import { analysisText, type AnalysisText } from "@/lib/analysis-text";
import type { Lang } from "@/lib/i18n";

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
      scripts?: Record<string, string>;
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

function checkImports(snapshot: RepositorySnapshot, x: AnalysisText): CheckResult {
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const aliases = aliasRoots(snapshot);
  const missing: Finding[] = [];

  for (const [file, source] of snapshot.contents) {
    // next-env.d.ts intentionally references generated .next type files that are gitignored.
    if (!SOURCE_EXTENSION.test(file) || path.posix.basename(file) === "next-env.d.ts") continue;

    for (const { specifier: original, line } of extractImports(source)) {
      const specifier = original.split(/[?#]/)[0];
      let candidates: string[] = [];
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        candidates = possibleImportTargets(path.posix.join(path.posix.dirname(file), specifier));
      } else if (specifier.startsWith("@/")) {
        candidates = aliases.flatMap((root) =>
          possibleImportTargets(path.posix.join(root, specifier.slice(2))),
        );
      } else {
        continue;
      }

      if (!candidates.some((candidate) => files.has(candidate))) {
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
      x.imports.summary(missing.length),
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

  const evidence = [
    ...riskyPackages.map((name) => `package.json → ${name}`),
    ...fsWrites.map((file) => x.server.write(file)),
  ];
  const title = x.titles.serverLibs;
  if (evidence.length) return makeCheck("server-libs", title, "red", x.server.red, x.server.fix, evidence);
  if (snapshot.partial) return makeCheck("server-libs", title, "yellow", x.server.partial, partialFix(snapshot, x));
  return makeCheck("server-libs", title, "green", x.server.ok, x.noChange);
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

    if (!SOURCE_EXTENSION.test(file)) continue;
    const envMatcher = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g;
    let match: RegExpExecArray | null;
    while ((match = envMatcher.exec(source))) {
      const name = match[1] || match[2];
      used.add(name);
      if (!locations.has(name)) locations.set(name, { file, line: lineAt(source, match.index) });
      if (/^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|ADMIN|DATABASE_URL)/.test(name)) {
        exposed.add(name);
      }
    }
  }

  const missing = [...used].filter((name) => !declared.has(name) && !BUILT_IN_ENV.has(name)).sort();
  const evidence = [
    ...missing.map((name) => x.env.evidenceMissing(name)),
    ...[...exposed].map((name) => x.env.evidenceExposed(name)),
  ];
  const title = x.titles.env;

  if (evidence.length) {
    return makeCheck("env", title, "red",
      [missing.length ? x.env.missing(missing.length, missing.join(", ")) : "",
        exposed.size ? x.env.exposed(exposed.size, [...exposed].join(", ")) : ""].filter(Boolean).join("; ") + ".",
      [missing.length ? x.env.fixMissing(missing.map((name) => `${name}=`).join(" + ")) : "",
        exposed.size ? x.env.fixExposed : ""].filter(Boolean).join("; ") + ".",
      evidence,
      [...missing.map((name) => ({ ...locations.get(name)!, problem: x.env.missingProblem(name),
        fix: x.env.missingFix(name), command: "git add -- .env.example" })),
        ...[...exposed].map((name) => ({ ...locations.get(name)!, problem: x.env.exposedProblem(name),
          fix: x.env.exposedFix(name.replace(/^NEXT_PUBLIC_/, "")) }))],
    );
  }
  if (snapshot.partial) return makeCheck("env", title, "yellow", x.env.partial, partialFix(snapshot, x));
  return makeCheck("env", title, "green", used.size ? x.env.okUsed : x.env.okNone, x.noChange);
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
    vercel: [checkServerLibraries],
    env: [checkEnvironment],
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
    summary,
    overall: summary.red ? "red" : summary.yellow ? "yellow" : "green",
    checks,
  };
}
