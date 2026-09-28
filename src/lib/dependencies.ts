import { builtinModules } from "node:module";

/**
 * Pure helpers for the dependencies check: which packages source files import, and what package.json
 * and the lockfile say about them. Lockfiles are read as text or JSON; nothing here needs a YAML library.
 */

export type ImportUse = { specifier: string; line: number; kind: "static" | "call" };

/** Blanks out comments while keeping strings, offsets and line breaks intact. */
export function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === "\\") { out += next ?? ""; index += 1; } else if (char === quote || (char === "\n" && quote !== "`")) quote = null;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") { out += " "; index += 1; }
      if (index < source.length) out += "\n";
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop - 1;
    } else {
      if (char === '"' || char === "'" || char === "`") quote = char;
      out += char;
    }
  }
  return out;
}

/** Every import that exists at runtime. Type-only imports (`import type`, `import { type A }`) are left out. */
export function moduleImports(source: string): ImportUse[] {
  const code = stripComments(source);
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  const found: ImportUse[] = [];
  const staticImport = /(?:^|[;\n}])\s*(import|export)\s+(type\s+)?(?:([^"'`;]*?)\s+from\s+)?["']([^"'\n]+)["']/g;
  for (const match of code.matchAll(staticImport)) {
    const clause = (match[3] ?? "").trim();
    const onlyTypes = /^\{\s*(?:type\s+[^,}]+,?\s*)+\}$/.test(clause);
    // `export { a }` without `from` never reaches here; `export * from` and `export { a } from` do.
    if (match[2] || onlyTypes) continue;
    found.push({ specifier: match[4], line: lineOf(match.index + match[0].indexOf(match[1])), kind: "static" });
  }
  for (const match of code.matchAll(/\b(?:require|import)\(\s*["']([^"'\n]+)["']\s*\)/g)) {
    found.push({ specifier: match[1], line: lineOf(match.index), kind: "call" });
  }
  return found;
}

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
// npm's rules for new package names: lowercase, URL-safe, optionally scoped.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The npm package a bare specifier points at, or null for relative paths, built-ins, URLs and aliases. */
export function packageName(specifier: string): string | null {
  if (/^(?:\.|\/|#|~|@\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (!PACKAGE_NAME.test(name) || BUILTINS.has(name) || BUILTINS.has(specifier)) return null;
  return name;
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Whether a text lockfile mentions the package at all, as an entry or as someone's dependency. It is
 * deliberately loose: a false "yes" only turns a red finding yellow, never the other way round.
 * Formats: package-lock (node_modules/x keys, v1 "x": {), pnpm-lock (x@1, /x@1, /x/1, x:), yarn.lock
 * (x@^1, "x@npm:^1", x "^1") and bun.lock ("x": [).
 */
export function lockfileMentions(lockfile: string, name: string): boolean {
  return new RegExp(`(?:^|[\\s,"'/])${escapeRegex(name)}(?=["']?(?:@|:|\\s|/\\d))`, "m").test(lockfile);
}

type Specifiers = Map<string, string>;
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export function manifestSpecifiers(manifest: Partial<Record<(typeof SECTIONS)[number], Record<string, string>>>): Specifiers {
  const all: Specifiers = new Map();
  for (const section of SECTIONS) for (const [name, range] of Object.entries(manifest[section] ?? {})) all.set(name, String(range));
  return all;
}

function unquote(text: string) {
  return text.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * The root project's direct dependencies as pnpm-lock.yaml records them (name -> specifier), for lockfile
 * v6 and v9 (with or without importers) and v5 (`specifiers:`). Null when the layout is not recognised.
 */
export function pnpmRootSpecifiers(lockfile: string): Specifiers | null {
  const lines = lockfile.replace(/\r\n/g, "\n").split("\n");
  const version = Number(unquote(lines.find((line) => line.startsWith("lockfileVersion:"))?.split(":")[1] ?? ""));
  if (!Number.isFinite(version) || version < 5) return null;

  // Find where the root project's sections start and how deep they are indented.
  let start = 0;
  let indent = 0;
  const importers = lines.indexOf("importers:");
  if (importers !== -1) {
    const root = lines.findIndex((line, index) => index > importers && /^ {2}(?:\.|'\.'|"\.")\s*:\s*$/.test(line));
    if (root === -1) return null;
    start = root + 1;
    indent = 4;
  }
  const specifiers: Specifiers = new Map();
  const sectionHeader = new RegExp(`^ {${indent}}(dependencies|devDependencies|optionalDependencies|specifiers):\\s*$`);
  let section: string | null = null;
  let current: string | null = null;
  let sawSection = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const depth = line.length - line.trimStart().length;
    if (depth < indent || (importers !== -1 && depth === 2)) break;
    if (depth === indent) {
      section = sectionHeader.exec(line)?.[1] ?? null;
      if (section) sawSection = true;
      current = null;
      continue;
    }
    if (!section) continue;
    const entry = /^(\s*)((?:'[^']+'|"[^"]+"|[^:\s]+))\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    const level = entry[1].length - indent;
    if (section === "specifiers" && level === 2) {
      specifiers.set(unquote(entry[2]), unquote(entry[3]));
    } else if (version >= 6 && level === 2) {
      current = unquote(entry[2]);
      // v6 inline form: `name: {specifier: ^1, version: 1.0.0}`
      const inline = /specifier:\s*([^,}]+)/.exec(entry[3]);
      if (inline) specifiers.set(current, unquote(inline[1]));
    } else if (version >= 6 && level === 4 && current && unquote(entry[2]) === "specifier") {
      specifiers.set(current, unquote(entry[3]));
    }
  }
  return sawSection || lines.some((line) => /^importers:|^specifiers:|^dependencies:|^devDependencies:/.test(line)) ? specifiers : null;
}

/** Package names listed under pnpm-lock.yaml's top-level `overrides:` (their specifiers can differ on purpose). */
export function pnpmOverrides(lockfile: string): Set<string> {
  const names = new Set<string>();
  const lines = lockfile.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("overrides:");
  if (start === -1) return names;
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(" ")) break;
    const key = /^ {2}((?:'[^']+'|"[^"]+"|[^:\s]+))\s*:/.exec(line)?.[1];
    if (key) names.add(unquote(key).replace(/^(@?[^@>]+).*$/, "$1"));
  }
  return names;
}

/** The root entry of package-lock.json v2/v3 (name -> range), or null for v1 and unreadable files. */
export function npmRootSpecifiers(lockfile: string): Specifiers | null {
  try {
    const parsed = JSON.parse(lockfile) as { lockfileVersion?: number; packages?: Record<string, Record<string, Record<string, string>>> };
    const root = parsed.packages?.[""];
    if (!parsed.lockfileVersion || parsed.lockfileVersion < 2 || !root) return null;
    return manifestSpecifiers(root);
  } catch {
    return null;
  }
}

/** Differences between package.json and a lockfile's record of the root project's direct dependencies. */
export function specifierDrift(manifest: Specifiers, locked: Specifiers, ignore: ReadonlySet<string> = new Set()) {
  const drift: Array<{ name: string; manifest?: string; locked?: string }> = [];
  for (const [name, range] of manifest) {
    if (ignore.has(name)) continue;
    if (locked.get(name) !== range) drift.push({ name, manifest: range, locked: locked.get(name) });
  }
  for (const [name, range] of locked) {
    if (!manifest.has(name) && !ignore.has(name)) drift.push({ name, locked: range });
  }
  return drift.sort((left, right) => left.name.localeCompare(right.name));
}

export type PathAliases = { prefixes: Array<{ prefix: string; targets: string[] }>; baseUrl?: string; extendsOther: boolean };

/** `compilerOptions.paths` and `baseUrl` from tsconfig/jsconfig text, which may contain comments and trailing commas. */
export function tsconfigAliases(text: string): PathAliases {
  const code = stripComments(text);
  const baseUrl = /"baseUrl"\s*:\s*"([^"]*)"/.exec(code)?.[1];
  const prefixes: PathAliases["prefixes"] = [];
  const pathsStart = code.search(/"paths"\s*:\s*\{/);
  if (pathsStart !== -1) {
    let depth = 0;
    let end = code.indexOf("{", pathsStart);
    for (let index = end; index < code.length; index += 1) {
      if (code[index] === "{") depth += 1;
      else if (code[index] === "}" && --depth === 0) { end = index; break; }
    }
    const body = code.slice(code.indexOf("{", pathsStart) + 1, end);
    for (const match of body.matchAll(/"([^"]+)"\s*:\s*\[([^\]]*)\]/g)) {
      const targets = [...match[2].matchAll(/"([^"]+)"/g)].map((target) => target[1].replace(/\*$/, "").replace(/^\.\//, ""));
      prefixes.push({ prefix: match[1].replace(/\*$/, ""), targets });
    }
  }
  return { prefixes, baseUrl: baseUrl?.replace(/^\.\/?/, "").replace(/\/$/, ""), extendsOther: /"extends"\s*:/.test(code) };
}
