import path from "node:path";
import type { CheckResult, CheckStatus, ReportResults } from "@/types/report";

export type RepositorySnapshot = {
  owner: string;
  name: string;
  defaultBranch: string;
  entries: Array<{ path: string; type: "blob" | "tree"; size?: number }>;
  contents: Map<string, string>;
  sourceFilesFound: number;
  sourceFilesRead: number;
  partial: boolean;
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
): CheckResult {
  return { id, title, status, explanation, fix, evidence: evidence.slice(0, 8) };
}

function parsePackageJson(snapshot: RepositorySnapshot) {
  const raw = snapshot.contents.get("package.json");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function checkNextEntrypoint(snapshot: RepositorySnapshot): CheckResult {
  const manifest = parsePackageJson(snapshot);
  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const hasNext = Boolean(packages.next);
  const routeRoots = ["app", "pages", "src/app", "src/pages"];
  const hasRouteFolder = snapshot.entries.some((entry) =>
    routeRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`)),
  );

  if (hasNext && !hasRouteFolder) {
    return makeCheck(
      "next-entry",
      "Next.js entrypoint",
      "red",
      "Next.js is declared in package.json, but the repository has no app/, pages/, src/app/, or src/pages/ folder.",
      "Add an App Router app/ directory with a root layout and page, or restore the Pages Router pages/ directory before deploying.",
      ["package.json → next", "No Next.js route folder found"],
    );
  }

  if (!manifest) {
    return makeCheck(
      "next-entry",
      "Next.js entrypoint",
      "yellow",
      "DeployDoctor could not read a valid root package.json, so it could not confirm the Next.js entrypoint.",
      "Commit a valid package.json at the repository root or point deployment tooling at the application root.",
    );
  }

  return makeCheck(
    "next-entry",
    "Next.js entrypoint",
    "green",
    hasNext
      ? "Next.js and a supported app/ or pages/ route folder are both present."
      : "The root package.json does not declare Next.js, so this Next.js-specific failure does not apply.",
    "No change is needed for this check.",
    hasNext ? ["package.json → next", "Route folder found"] : [],
  );
}

function extractImports(source: string): string[] {
  const imports = new Set<string>();
  const staticImport = /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  const callImport = /(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;

  for (const matcher of [staticImport, callImport]) {
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(source))) imports.add(match[1]);
  }
  return [...imports];
}

function possibleImportTargets(base: string): string[] {
  const clean = path.posix.normalize(base).replace(/^\.\//, "");
  const targets = [clean];
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

function checkImports(snapshot: RepositorySnapshot): CheckResult {
  const files = new Set(snapshot.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const aliases = aliasRoots(snapshot);
  const missing = new Set<string>();

  for (const [file, source] of snapshot.contents) {
    // next-env.d.ts intentionally references generated .next type files that are gitignored.
    if (!SOURCE_EXTENSION.test(file) || path.posix.basename(file) === "next-env.d.ts") continue;

    for (const specifier of extractImports(source)) {
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
        missing.add(`${file} → ${specifier}`);
      }
    }
  }

  if (missing.size) {
    return makeCheck(
      "imports",
      "Broken imports",
      "red",
      `${missing.size} local import${missing.size === 1 ? "" : "s"} point to files that do not exist in the repository tree.`,
      "Correct each import path or commit the missing file, preserving filename casing for Vercel's Linux filesystem.",
      [...missing],
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "imports",
      "Broken imports",
      "yellow",
      "No broken local imports were found in the files read, but GitHub limits prevented a complete source scan.",
      "Add GITHUB_TOKEN for a higher API limit and run the report again to scan more source files.",
      [`Read ${snapshot.sourceFilesRead} of ${snapshot.sourceFilesFound} source files`],
    );
  }

  return makeCheck(
    "imports",
    "Broken imports",
    "green",
    "Every relative and @/ import found resolves to a file in the repository tree.",
    "No change is needed for this check.",
    [`Read ${snapshot.sourceFilesRead} source files`],
  );
}

function checkServerLibraries(snapshot: RepositorySnapshot): CheckResult {
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
    ...fsWrites.map((file) => `${file} → filesystem write`),
  ];
  if (evidence.length) {
    return makeCheck(
      "server-libs",
      "Vercel-incompatible server code",
      "red",
      "The repository includes a heavyweight browser, SQLite binding, or API-route filesystem write that is unsafe for Vercel Functions.",
      "Move browser work to an external worker, replace SQLite with a hosted database, and write generated files to object storage instead of the function filesystem.",
      evidence,
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "server-libs",
      "Vercel-incompatible server code",
      "yellow",
      "No risky server package was declared, but not every API route could be inspected for filesystem writes.",
      "Add GITHUB_TOKEN and rescan, then replace any API-route filesystem writes with object storage.",
    );
  }

  return makeCheck(
    "server-libs",
    "Vercel-incompatible server code",
    "green",
    "No Playwright, Puppeteer, SQLite binding, or filesystem write in an API route was found.",
    "No change is needed for this check.",
  );
}

function checkEnvironment(snapshot: RepositorySnapshot): CheckResult {
  const declared = new Set<string>();
  const used = new Set<string>();
  const exposed = new Set<string>();

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
      if (/^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|ADMIN|DATABASE_URL)/.test(name)) {
        exposed.add(name);
      }
    }
  }

  const missing = [...used].filter((name) => !declared.has(name) && !BUILT_IN_ENV.has(name)).sort();
  const evidence = [
    ...missing.map((name) => `${name} → missing from committed env template`),
    ...[...exposed].map((name) => `${name} → potentially secret NEXT_PUBLIC_ variable`),
  ];

  if (evidence.length) {
    return makeCheck(
      "env",
      "Environment variables",
      "red",
      `${missing.length} environment variable${missing.length === 1 ? " is" : "s are"} undocumented and ${exposed.size} potentially secret variable${exposed.size === 1 ? " is" : "s are"} exposed to the browser.`,
      "Document every required variable in .env.example and remove NEXT_PUBLIC_ from secrets before adding them to Vercel.",
      evidence,
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "env",
      "Environment variables",
      "yellow",
      "The scanned variables are documented and server-safe, but the source scan was incomplete.",
      "Add GITHUB_TOKEN and rescan to verify environment usage across the entire repository.",
    );
  }

  return makeCheck(
    "env",
    "Environment variables",
    "green",
    used.size
      ? "Every process.env variable found is documented and no secret-looking value uses NEXT_PUBLIC_."
      : "No process.env usage or browser-exposed secret was found.",
    "No change is needed for this check.",
  );
}

function hasUseClient(source: string): boolean {
  return /^\s*["']use client["']\s*;?/.test(source);
}

function checkSupabase(snapshot: RepositorySnapshot): CheckResult {
  const violations = new Set<string>();
  const browserClient = /\bcreateBrowserClient\b|["'][^"']*supabase\/(?:client|browser)["']/;
  const serviceRole = /\b(?:NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET)[A-Z0-9_]*|SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY)\b/;

  for (const [file, source] of snapshot.contents) {
    if (!SOURCE_EXTENSION.test(file)) continue;
    const clientFile = hasUseClient(source);
    const serverContext = API_ROUTE.test(file) || (SERVER_COMPONENT.test(file) && !clientFile);

    if (serverContext && browserClient.test(source)) {
      violations.add(`${file} → browser Supabase client in server code`);
    }
    if (clientFile && serviceRole.test(source)) {
      violations.add(`${file} → service role key referenced by client code`);
    }
  }

  if (violations.size) {
    return makeCheck(
      "supabase",
      "Supabase server/client boundaries",
      "red",
      "Supabase browser credentials are used in server code or the service role key is referenced from a Client Component.",
      "Use Supabase credentials only in server-only modules, and keep SUPABASE_SECRET_KEY or the legacy service role key out of Client Components.",
      [...violations],
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "supabase",
      "Supabase server/client boundaries",
      "yellow",
      "No Supabase boundary violation was found in the files read, but the source scan was incomplete.",
      "Add GITHUB_TOKEN and rescan to verify every server and Client Component boundary.",
    );
  }

  return makeCheck(
    "supabase",
    "Supabase server/client boundaries",
    "green",
    "No Supabase browser client is used in server code and no service role key is referenced in client code.",
    "No change is needed for this check.",
  );
}

export function analyzeSnapshot(snapshot: RepositorySnapshot): ReportResults {
  const checks = [
    checkNextEntrypoint(snapshot),
    checkImports(snapshot),
    checkServerLibraries(snapshot),
    checkEnvironment(snapshot),
    checkSupabase(snapshot),
  ];
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
    },
    summary,
    overall: summary.red ? "red" : summary.yellow ? "yellow" : "green",
    checks,
  };
}
