import path from "node:path";
import type { Category, CheckResult, CheckStatus, ReportResults, Finding } from "@/types/report";
import { CATEGORIES, categoryOf } from "@/lib/categories";
import { defaultChecks, detectStack } from "@/lib/stack";

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
function partialFix(snapshot: RepositorySnapshot) {
  return !snapshot.partialReasons?.length || snapshot.partialReasons.includes("rate_limit")
    ? "Lägg till GITHUB_TOKEN i Vercel > Settings > Environment Variables, deploya om och skanna igen."
    : "Skanna igen; stora filer och stora repon kan behöva kontrolleras manuellt.";
}
function partialMessage(snapshot: RepositorySnapshot) {
  const cause = snapshot.partialReasons?.includes("rate_limit") ? "sedan stoppade GitHub oss (rate limit)"
    : "sedan nådde vi en fil-, tids- eller läsgräns";
  return `Vi läste ${snapshot.sourceFilesRead} av ${snapshot.sourceFilesFound} filer; ${cause}.`;
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
      ? "✅ Next.js entrypoint found - no change needed"
      : "The root package.json does not declare Next.js, so this Next.js-specific failure does not apply.",
    "No change is needed for this check.",
    hasNext ? ["package.json → next", "Route folder found"] : [],
  );
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

function checkImports(snapshot: RepositorySnapshot): CheckResult {
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
        missing.push({ file, line, problem: `imports ${original} which doesn't exist in the repository`,
          fix: `Lägg till ${target} om filen finns lokalt, eller ändra importen på rad ${line} till filens riktiga plats.`,
          command: `git add -- ${shellQuote(target)}` });
      }
    }
  }

  if (missing.length) {
    return makeCheck(
      "imports",
      "Broken imports",
      "red",
      `${missing.length} import${missing.length === 1 ? "" : "er"} pekar på filer som saknas i GitHub-repot.`,
      missing[0].fix,
      missing.map((item) => `${item.file}:${item.line} → ${item.problem}`), missing,
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "imports",
      "Broken imports",
      "yellow",
      partialMessage(snapshot),
      partialFix(snapshot),
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
      "Inga farliga paket hittade hittills, men vi kunde inte kolla alla API-routes.",
      partialFix(snapshot),
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
    ...missing.map((name) => `${name} → missing from committed env template`),
    ...[...exposed].map((name) => `${name} → potentially secret NEXT_PUBLIC_ variable`),
  ];

  if (evidence.length) {
    return makeCheck(
      "env",
      "Environment variables",
      "red",
      [missing.length ? `${missing.length} env-variabler saknas i .env.example: ${missing.join(", ")}` : "",
        exposed.size ? `${exposed.size} möjliga hemligheter exponeras i webbläsaren: ${[...exposed].join(", ")}` : ""].filter(Boolean).join("; ") + ".",
      [missing.length ? `Lägg till tomma rader i .env.example i root: ${missing.map((name) => `${name}=`).join(" och ")}; pusha filen` : "",
        exposed.size ? "ta bort NEXT_PUBLIC_ från hemligheterna och rotera exponerade nycklar" : ""].filter(Boolean).join("; ") + ".",
      evidence,
      [...missing.map((name) => ({ ...locations.get(name)!, problem: `${name} saknas i .env.example`,
        fix: `Lägg till ${name}= (tomt) i .env.example; sätt värdet privat i Vercel.`, command: "git add -- .env.example" })),
        ...[...exposed].map((name) => ({ ...locations.get(name)!, problem: `${name} kan exponera en hemlighet`,
          fix: `Använd ${name.replace(/^NEXT_PUBLIC_/, "")} enbart på servern och rotera den gamla nyckeln.` }))],
    );
  }

  if (snapshot.partial) {
    return makeCheck(
      "env",
      "Environment variables",
      "yellow",
      "De env-variabler vi läste är dokumenterade, men scannen blev inte klar.",
      partialFix(snapshot),
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
      "Ingen Supabase-förväxling hittad, men scannen blev inte klar.",
      partialFix(snapshot),
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

function checkPrisma(snapshot: RepositorySnapshot): CheckResult {
  const title = "Prisma / database";
  const manifest = parsePackageJson(snapshot);
  const packages = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const usesPrisma = "prisma" in packages || "@prisma/client" in packages;
  const usesDrizzle = "drizzle-orm" in packages || "drizzle-kit" in packages;

  if (!usesPrisma) {
    return makeCheck("prisma", title, "green",
      usesDrizzle
        ? "Drizzle hittades. SQLite-drivrutiner fångas av kontrollen för Vercel-inkompatibel serverkod."
        : "Varken Prisma eller Drizzle hittades i package.json, så det finns inget att kontrollera.",
      "No change is needed for this check.");
  }

  const findings: Finding[] = [];
  const buildScripts = ["postinstall", "build", "vercel-build"].map((name) => manifest?.scripts?.[name] ?? "").join("\n");
  if (!/prisma\s+generate/.test(buildScripts)) {
    findings.push({ file: "package.json", line: 1,
      problem: "kör inte prisma generate vid installation eller bygge",
      fix: 'Lägg till "postinstall": "prisma generate" under scripts i package.json; Vercel cachar node_modules och Prisma Client blir annars föråldrad.',
      command: "git add -- package.json" });
  }
  for (const [file, source] of snapshot.contents) {
    if (!/\.prisma$/.test(file)) continue;
    const match = /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"sqlite"/.exec(source);
    if (match) {
      findings.push({ file, line: lineAt(source, match.index), problem: "använder SQLite, som inte fungerar på Vercel Functions",
        fix: "Byt provider till en hostad databas (t.ex. postgresql) och sätt DATABASE_URL i Vercel." });
    }
  }

  if (findings.length) {
    return makeCheck("prisma", title, "red",
      `${findings.length} Prisma-problem kan stoppa bygget eller databasen på Vercel.`,
      findings[0].fix, findings.map((item) => `${item.file}:${item.line} → ${item.problem}`), findings);
  }
  if (snapshot.partial) {
    return makeCheck("prisma", title, "yellow", "Inga Prisma-problem hittades i det vi läste, men scannen blev inte klar.", partialFix(snapshot));
  }
  return makeCheck("prisma", title, "green", "prisma generate körs vid bygge och ingen SQLite-databas hittades.", "No change is needed for this check.");
}

export function analyzeSnapshot(snapshot: RepositorySnapshot, options: { checks?: Category[] } = {}): ReportResults {
  const envText: string[] = [];
  const sources: string[] = [];
  for (const [file, source] of snapshot.contents) {
    if (/(?:^|\/)\.env(?:\..+)?$/.test(file)) envText.push(source);
    else if (SOURCE_EXTENSION.test(file)) sources.push(source);
  }
  const stack = detectStack({ packageJson: snapshot.contents.get("package.json"), envText: envText.join("\n"), sources });
  // Without an explicit choice, scan only what the detected stack needs.
  const chosen = new Set(options.checks ?? defaultChecks(stack));
  const runners: Record<Category, Array<(snapshot: RepositorySnapshot) => CheckResult>> = {
    next: [checkNextEntrypoint, checkImports],
    vercel: [checkServerLibraries],
    env: [checkEnvironment],
    supabase: [checkSupabase],
    prisma: [checkPrisma],
  };
  const scanned = CATEGORIES.filter((category) => chosen.has(category));
  const checks = scanned.flatMap((category) => runners[category].map((run) => run(snapshot)));
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
