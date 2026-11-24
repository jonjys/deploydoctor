/**
 * Dependency check for "Is this GitHub repo safe?": a repository's own code can be clean while one of its npm packages
 * is known malware, runs a script the moment it is installed, sits one letter away from a popular name, or is barely
 * used by anyone. Read from package.json and the lockfile plus three public npm endpoints. Nothing is installed or run.
 */

export type DepPackage = { name: string; version: string | null; direct: boolean; dev: boolean; installScript: boolean };
export type DepSeverity = "critical" | "high" | "medium" | "info";
export type DepFinding = { kind: "malware" | "advisory" | "install-script" | "typosquat" | "low-downloads"; severity: DepSeverity; package: string; version?: string | null; title: string; detail: string; url?: string };
export type DependencyReport = {
  ecosystem: "npm";
  total: number;
  direct: number;
  lockfile: boolean;
  findings: DepFinding[];
  counts: Record<DepSeverity, number>;
  partial: boolean;
};
/** What a visitor without a pass sees: how much there is to look at, never which packages. */
export type DependencyTeaser = Omit<DependencyReport, "findings"> & { locked: true };

const MAX_PACKAGES = 2500;
const NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
type LockV1 = { lockfileVersion?: number; dependencies?: Record<string, { version?: string; dev?: boolean; dependencies?: LockV1["dependencies"] }> };
type LockV2 = { lockfileVersion?: number; packages?: Record<string, { version?: string; dev?: boolean; hasInstallScript?: boolean; link?: boolean }> };

/** Every package the repository installs: the lockfile's full tree when committed, otherwise package.json's direct list. */
export function dependencyPackages(packageJson: string, lockfile?: string | null): { packages: DepPackage[]; lockfile: boolean; partial: boolean } {
  let manifest: Manifest;
  try { manifest = JSON.parse(packageJson) as Manifest; } catch { return { packages: [], lockfile: false, partial: true }; }
  const runtime = new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }));
  const dev = new Set(Object.keys(manifest.devDependencies ?? {}));
  const direct = new Set([...runtime, ...dev]);
  const out = new Map<string, DepPackage>();
  const add = (pkg: DepPackage) => { if (NAME.test(pkg.name) && out.size < MAX_PACKAGES) out.set(`${pkg.name}@${pkg.version ?? ""}`, pkg); };

  let lock: LockV1 & LockV2 | null = null;
  if (lockfile) { try { lock = JSON.parse(lockfile) as LockV1 & LockV2; } catch { lock = null; } }
  if (lock?.packages) {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.link || !entry.version) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      add({ name, version: entry.version, direct: path === `node_modules/${name}` && direct.has(name), dev: Boolean(entry.dev), installScript: Boolean(entry.hasInstallScript) });
    }
  } else if (lock?.dependencies) {
    const walk = (deps: LockV1["dependencies"], top: boolean) => {
      for (const [name, entry] of Object.entries(deps ?? {})) {
        if (entry.version && !/^(?:file|link|git|github):/.test(entry.version)) add({ name, version: entry.version, direct: top && direct.has(name), dev: Boolean(entry.dev), installScript: false });
        if (entry.dependencies) walk(entry.dependencies, false);
      }
    };
    walk(lock.dependencies, true);
  } else {
    for (const name of direct) add({ name, version: null, direct: true, dev: dev.has(name) && !runtime.has(name), installScript: false });
  }
  return { packages: [...out.values()], lockfile: Boolean(lock?.packages || lock?.dependencies), partial: out.size >= MAX_PACKAGES };
}

/** Packages people rely on, for spotting a name one keystroke away. Kept short and well known on purpose. */
const POPULAR = ["react", "react-dom", "next", "vue", "svelte", "angular", "express", "koa", "fastify", "axios", "lodash", "underscore", "moment", "dayjs", "date-fns", "chalk", "commander", "yargs", "dotenv", "debug", "request", "node-fetch", "cross-env", "cross-spawn", "rimraf", "glob", "minimist", "uuid", "nanoid", "classnames", "clsx", "zod", "yup", "joi", "jsonwebtoken", "bcrypt", "bcryptjs", "mongoose", "mongodb", "mysql", "mysql2", "pg", "sequelize", "prisma", "typeorm", "redis", "ioredis", "socket.io", "ws", "webpack", "vite", "rollup", "esbuild", "babel-core", "typescript", "eslint", "prettier", "jest", "mocha", "chai", "vitest", "puppeteer", "playwright", "electron", "tailwindcss", "postcss", "autoprefixer", "sass", "styled-components", "graphql", "apollo-server", "stripe", "openai", "discord.js", "telegraf", "twilio", "nodemailer", "multer", "body-parser", "cors", "helmet", "morgan", "winston", "pino", "colors", "colors.js", "ethers", "web3", "solana", "crypto-js", "sharp", "jimp", "cheerio", "jquery", "bootstrap", "three", "d3", "chart.js", "inquirer", "ora", "semver", "fs-extra", "mkdirp", "nodemon", "concurrently", "husky", "lint-staged", "core-js", "tslib", "rxjs", "immer", "redux", "zustand", "swr", "@supabase/supabase-js", "firebase", "aws-sdk", "googleapis", "puppeteer-core", "electron-builder"];
const POPULAR_SET = new Set(POPULAR);

/** Damerau–Levenshtein distance, capped: only 0, 1 or "more" matter here. */
function closeTo(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] === 1;
}

export function typosquatOf(name: string): string | null {
  if (POPULAR_SET.has(name) || name.length < 4) return null;
  const bare = name.replace(/[-_.]/g, "");
  for (const popular of POPULAR) {
    if (popular.length < 4) continue;
    if (closeTo(name, popular) || (bare === popular.replace(/[-_.]/g, "") && name !== popular)) return popular;
  }
  return null;
}

/** Packages known to need an install step for honest reasons (native binaries, browser downloads, git hooks). */
const EXPECTED_INSTALL = /^(?:esbuild|@esbuild\/.*|sharp|@img\/.*|@swc\/core.*|fsevents|bcrypt|sqlite3|better-sqlite3|canvas|node-sass|puppeteer|puppeteer-core|playwright|playwright-core|electron|core-js|core-js-pure|husky|protobufjs|@parcel\/watcher|msgpackr-extract|cpu-features|ssh2|deasync|re2|unrs-resolver|@prisma\/.*|prisma|nx|@nx\/.*|turbo|lefthook|simple-git-hooks|es5-ext|styled-components|spawn-sync|bufferutil|utf-8-validate|keytar|node-pty|@sentry\/cli|@sentry\/profiling-node|cypress|nodemon|grpc|@grpc\/grpc-js|argon2|leveldown|dtrace-provider|iltorb|uws|zeromq|gifsicle|mozjpeg|optipng-bin|pngquant-bin|cwebp-bin)$/;

export type Advisory = { title?: string; severity?: string; url?: string; vulnerable_versions?: string; cwe?: string[] };
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function advisories(packages: DepPackage[], fetcher: Fetcher): Promise<Map<string, Advisory[]> | null> {
  const byName = new Map<string, Set<string>>();
  for (const p of packages) if (p.version) byName.set(p.name, (byName.get(p.name) ?? new Set()).add(p.version));
  const names = [...byName.keys()];
  const result = new Map<string, Advisory[]>();
  try {
    for (let i = 0; i < names.length; i += 500) {
      const body = Object.fromEntries(names.slice(i, i + 500).map(name => [name, [...byName.get(name)!]]));
      const response = await fetcher("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return null;
      for (const [name, list] of Object.entries(await response.json() as Record<string, Advisory[]>)) result.set(name, list);
    }
    return result;
  } catch { return null; }
}

/** Weekly downloads for direct dependencies: a package almost nobody installs deserves a second look. */
async function weeklyDownloads(names: string[], fetcher: Fetcher): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const unscoped = names.filter(n => !n.startsWith("@")).slice(0, 128);
  try {
    if (unscoped.length) {
      const response = await fetcher(`https://api.npmjs.org/downloads/point/last-week/${unscoped.map(encodeURIComponent).join(",")}`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const body = await response.json() as Record<string, { downloads?: number } | null> & { downloads?: number; package?: string };
        if (unscoped.length === 1 && typeof body.downloads === "number") result.set(unscoped[0], body.downloads);
        else for (const name of unscoped) { const row = body[name]; if (row && typeof row.downloads === "number") result.set(name, row.downloads); }
      }
    }
  } catch { /* downloads are a hint, never required */ }
  return result;
}

/**
 * Malware, not a vulnerability: GitHub files those under CWE-506 (Embedded Malicious Code), titled "Malicious
 * Package in x" or "Embedded malware in x". A title merely mentioning "a malicious website" is an ordinary flaw.
 */
const MALWARE_TITLE = /^(?:malicious (?:package|code|version)s?|embedded mal(?:icious code|ware)|malware) in /i;
export const isMalware = (advisory: Advisory) => Boolean(advisory.cwe?.includes("CWE-506") || MALWARE_TITLE.test(advisory.title ?? ""));

export async function checkDependencies(packages: DepPackage[], meta: { lockfile: boolean; partial: boolean }, fetcher: Fetcher = fetch): Promise<DependencyReport> {
  const findings: DepFinding[] = [];
  const known = await advisories(packages, fetcher);
  if (known) for (const [name, list] of known) {
    const version = packages.find(p => p.name === name && p.version)?.version ?? null;
    for (const advisory of list) {
      const malware = isMalware(advisory);
      if (!malware && !["critical", "high"].includes(advisory.severity ?? "")) continue;
      findings.push({ kind: malware ? "malware" : "advisory", severity: malware ? "critical" : advisory.severity === "critical" ? "critical" : "high", package: name, version,
        title: malware ? `${name} is known malware` : `${name} has a ${advisory.severity} security advisory`, detail: advisory.title ?? "Published advisory.", url: advisory.url });
    }
  }
  for (const p of packages) {
    if (p.installScript && !EXPECTED_INSTALL.test(p.name)) findings.push({ kind: "install-script", severity: "medium", package: p.name, version: p.version,
      title: `${p.name} runs a script when installed`, detail: "npm runs it during npm install, before you have used the package. Common for native modules, and exactly how malicious packages get in." });
  }
  // A name one letter from a popular package is only a red flag when hardly anyone installs it: preact is near
  // react but has millions of weekly downloads. Unknown download counts never raise the flag.
  const squats = new Map(packages.map(p => [p.name, typosquatOf(p.name)] as const).filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
  const directNames = [...new Set(packages.filter(p => p.direct && !POPULAR_SET.has(p.name)).map(p => p.name))];
  const downloads = await weeklyDownloads([...new Set([...directNames, ...squats.keys()])], fetcher);
  for (const [name, popular] of squats) {
    const count = downloads.get(name);
    if (count !== undefined && count < 5000) findings.push({ kind: "typosquat", severity: "high", package: name, version: packages.find(p => p.name === name)?.version,
      title: `${name} is one letter away from ${popular}`, detail: `Only ${count.toLocaleString("en-US")} downloads last week, next to the popular ${popular}. Check that you meant ${name}: look-alike names are a common way to slip malware into a project.` });
  }
  for (const [name, count] of downloads) if (count < 200 && directNames.includes(name) && !squats.has(name)) findings.push({ kind: "low-downloads", severity: "medium", package: name, title: `${name} was downloaded ${count.toLocaleString("en-US")} time${count === 1 ? "" : "s"} last week`, detail: "Almost nobody uses it. Read its code or its repository before you trust it with your machine." });

  const order: Record<DepSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.package.localeCompare(b.package));
  const unique = [...new Map(findings.map(f => [`${f.kind}:${f.package}:${f.title}`, f])).values()].slice(0, 60);
  const counts: Record<DepSeverity, number> = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of unique) counts[f.severity]++;
  return { ecosystem: "npm", total: packages.length, direct: packages.filter(p => p.direct).length, lockfile: meta.lockfile, findings: unique, counts, partial: meta.partial || known === null };
}

export function teaser(report: DependencyReport): DependencyTeaser {
  const { findings: _hidden, ...rest } = report;
  void _hidden;
  return { ...rest, locked: true };
}
