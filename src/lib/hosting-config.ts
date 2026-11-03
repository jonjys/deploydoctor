import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";
import { parse as parseToml } from "smol-toml";
import { moduleImports } from "@/lib/dependencies";
import { SourceGraph } from "@/lib/source-graph";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { Finding } from "@/types/report";

import { hostingPlatforms } from "@/lib/hosting-targets";
export { HOST_CONFIG_FILE, hostingPlatforms, hasAlternativeHost } from "@/lib/hosting-targets";
export type HostingAudit = { platforms: string[]; filesRead: string[]; evaluatedRules: string[]; findings: Finding[]; limitations: string[] };
type Table = Record<string, unknown>;
const table = (v: unknown): Table => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Table : {};
const array = (v: unknown): Table[] => Array.isArray(v) ? v.map(table) : [];
const string = (v: unknown) => typeof v === "string" ? v : undefined;
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literalPath = (v: string) => v.length > 0 && !/[\\$*?{}\0\r\n]/.test(v) && !path.posix.isAbsolute(v) && !v.split("/").includes("..");
const generated = /(?:^|\/)(?:dist|build|out|target|\.output|\.open-next|\.svelte-kit|\.netlify)(?:\/|$)/;

/** Configuration is data, never imported. Unknown dashboard/CLI overrides remain explicitly unverified. */
export function auditHosting(s: RepositorySnapshot): HostingAudit {
  const paths = new Set(s.entries.filter(e => e.type === "blob").map(e => e.path));
  const wranglers = ["wrangler.json", "wrangler.jsonc", "wrangler.toml"].filter(f => paths.has(f));
  const out: HostingAudit = { platforms: hostingPlatforms(paths), filesRead: [], evaluatedRules: [], findings: [], limitations: [] };
  const evaluated = new Set<string>();
  const add = (ruleId: string, file: string, line: number, problem: string, fix: string, status: "red" | "yellow" = "yellow") => {
    if (out.findings.length < 100) out.findings.push({ ruleId, file, line, problem, fix, status: wranglers.length > 1 && wranglers.includes(file) ? "yellow" : status });
    else if (!out.limitations.includes("Platform finding limit reached.")) out.limitations.push("Platform finding limit reached.");
  };
  const read = (file: string): { config: Table; at: (keys: string[]) => number; raw: string } | null => {
    const raw = s.contents.get(file);
    if (raw === undefined) { if (paths.has(file)) out.limitations.push(`${file} was not read.`); return null; }
    out.filesRead.push(file);
    evaluated.add("hosting-config-syntax");
    try {
      let config: unknown, json: ts.JsonSourceFile | undefined;
      if (file.endsWith(".toml")) config = parseToml(raw);
      else {
        json = ts.parseJsonText(file, raw);
        const converted = file === "railway.json" ? { config: JSON.parse(raw), error: undefined } : ts.parseConfigFileTextToJson(file, raw);
        if (converted.error || (json as ts.JsonSourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) throw new Error("syntax");
        config = converted.config;
      }
      if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error("shape");
      const at = (keys: string[]) => {
        if (!keys.length) return 1;
        if (json) {
          let node: ts.Node | undefined = json.statements[0];
          if (node && ts.isExpressionStatement(node)) node = node.expression;
          for (const key of keys) {
            if (!node || !ts.isObjectLiteralExpression(node)) break;
            const property: ts.PropertyAssignment | undefined = node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === key);
            if (!property) break;
            node = property.initializer;
          }
          return node ? json.getLineAndCharacterOfPosition(node.getStart(json)).line + 1 : 1;
        }
        let section = "", first = 1;
        const prefix = keys.slice(0, -1).join("."), key = keys.at(-1)!;
        for (const [index, source] of raw.split("\n").entries()) {
          const header = /^\s*\[\[?([^\]]+)\]\]?/.exec(source);
          if (header) section = header[1].replace(/["'\s]/g, "");
          if (section === prefix) { first = index + 1; if (new RegExp(`^\\s*["']?${escape(key)}["']?\\s*=`).test(source)) return index + 1; }
        }
        return first;
      };
      return { config: config as Table, at, raw };
    } catch {
      add("hosting-config-syntax", file, 1, `Invalid ${file.endsWith(".toml") ? "TOML" : "JSON/JSONC"} configuration.`, "Correct the configuration syntax and validate it with the hosting provider CLI.", "red");
      return null;
    }
  };
  let rootManifest: Table = {};
  try { rootManifest = table(JSON.parse(s.contents.get("package.json") ?? "{}")); } catch { /* Existing manifest check owns this. */ }
  const hasBuild = typeof table(rootManifest.scripts).build === "string";
  const graph = new SourceGraph(s);
  const importCache = new Map<string, ReturnType<typeof moduleImports>>();
  if (wranglers.length > 1) { out.limitations.push("Multiple Wrangler configurations: the CLI-selected configuration is not known."); add("cloudflare-config-selection", wranglers[0], 1, "Multiple Wrangler configurations are committed.", "Verify which configuration your deploy command selects; remove obsolete copies if appropriate."); }
  for (const file of wranglers) {
    const doc = read(file); if (!doc) continue;
    const root = doc.config;
    const envs = Object.entries(table(root.env));
    if (envs.length > 32) out.limitations.push("Only the first 32 Wrangler environments were inspected.");
    const scopes: Array<{ config: Table; prefix: string[] }> = [{ config: root, prefix: [] }, ...envs.slice(0, 32).map(([name, value]) => ({ config: table(value), prefix: ["env", name] }))];
    for (const { config: local, prefix } of scopes) {
      const value = (key: string) => Object.hasOwn(local, key) ? local[key] : root[key];
      const location = (key: string) => doc.at(Object.hasOwn(local, key) ? [...prefix, key] : [key]);
      const label = prefix.length ? ` (${prefix.join(".")})` : "";
      evaluated.add("cloudflare-compatibility-date");
      const date = value("compatibility_date");
      const validDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
      if (date !== undefined && !validDate) add("cloudflare-compatibility-date", file, location("compatibility_date"), `compatibility_date is not a valid YYYY-MM-DD date${label}.`, "Set an explicit valid compatibility date and test the Worker before changing runtime behavior.", prefix.length ? "yellow" : "red");
      else if (date === undefined) add("cloudflare-compatibility-date", file, 1, `No compatibility_date is recorded in this Wrangler configuration${label}.`, "Set it in Wrangler or verify the deploy command supplies it. The scanner cannot read CLI overrides.");
      const main = string(value("main"));
      if (main && literalPath(main)) {
        evaluated.add("cloudflare-entrypoint");
        const entry = path.posix.normalize(main);
        const customBuild = typeof table(value("build")).command === "string" || hasBuild || generated.test(entry);
        if (!paths.has(entry)) {
          const unreadable = s.partial || customBuild || wranglers.length > 1;
          add("cloudflare-entrypoint", file, location("main"), `Worker entrypoint ${entry} is not in the scanned commit${label}.`, customBuild ? "Run the declared build and verify it generates this exact Worker entrypoint. Generated output is not required to be committed." : "Commit the entrypoint or correct main, including its letter case. Verify any CLI or build overrides.", unreadable || prefix.length ? "yellow" : "red");
        } else {
          const flags = Array.isArray(value("compatibility_flags")) ? value("compatibility_flags") as unknown[] : [];
          const nodeAvailable = flags.includes("nodejs_compat") || flags.includes("nodejs_compat_v2") || (validDate && (date as string) >= "2026-08-04" && !(flags.includes("no_nodejs_compat") && flags.includes("no_nodejs_compat_v2")));
          evaluated.add("cloudflare-node-compatibility");
          if (!nodeAvailable && validDate) {
            const queue = [entry], visited = new Set<string>();
            while (queue.length && visited.size < 400) {
              const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current);
              const parsed = graph.parse(current);
              if (!parsed) { out.limitations.push(`Worker import coverage incomplete at ${current}.`); continue; }
              if (!importCache.has(current)) importCache.set(current, moduleImports(parsed.text, current));
              for (const use of importCache.get(current)!) {
                const builtinName = use.specifier.replace(/^node:/, "");
                if (builtinModules.includes(builtinName) || use.specifier.startsWith("node:")) add("cloudflare-node-compatibility", current, use.line, `Worker code imports ${use.specifier}, but Node.js compatibility is not enabled by the recorded date and flags${label}.`, "For dates before 2026-08-04, configure nodejs_compat or a deliberately tested runtime/polyfill setup. Newer dates enable Node compatibility by default; verify supported APIs with Wrangler.");
                else { const target = graph.resolve(current, use.specifier); if (target.kind === "file") queue.push(target.file); else if (target.kind === "unread") out.limitations.push(`Worker import coverage incomplete at ${target.file}.`); }
              }
            }
          }
        }
      }
      evaluated.add("cloudflare-binding-collision");
      // Binding collections are not inherited across Wrangler environments.
      const bindings = [...["kv_namespaces", "r2_buckets", "d1_databases", "services", "hyperdrive"].flatMap(k => array(local[k]).map(v => ({ name: string(v.binding), kind: k }))),
        ...array(table(local.durable_objects).bindings).map(v => ({ name: string(v.name), kind: "durable_objects" })),
        ...array(table(local.queues).producers).map(v => ({ name: string(v.binding), kind: "queues" })), { name: string(table(local.assets).binding), kind: "assets" }];
      const names = new Map<string, string>();
      for (const binding of bindings) if (binding.name) { const previous = names.get(binding.name); if (previous) add("cloudflare-binding-collision", file, doc.at(prefix), `Binding ${binding.name} occurs in both ${previous} and ${binding.kind}${label}.`, "Give bindings distinct names within this environment and update the matching env references."); else names.set(binding.name, binding.kind); }
      evaluated.add("cloudflare-pages-worker-config");
      if (value("pages_build_output_dir") !== undefined && (main || value("assets") !== undefined)) add("cloudflare-pages-worker-config", file, location("pages_build_output_dir"), `Pages output configuration is mixed with Worker main/assets settings${label}.`, "Confirm whether this project deploys to Pages or Workers and use the corresponding Wrangler configuration.");
      evaluated.add("cloudflare-assets-directory");
      const assetDir = string(table(value("assets")).directory);
      if (assetDir && literalPath(assetDir) && paths.has(path.posix.normalize(assetDir))) add("cloudflare-assets-directory", file, location("assets"), `assets.directory points at a committed file, ${assetDir}, rather than a directory${label}.`, "Point assets.directory at the directory containing the generated public assets.", prefix.length ? "yellow" : "red");
    }
  }
  const netlify = paths.has("netlify.toml") ? read("netlify.toml") : null;
  if (netlify) {
    const root = netlify.config, contexts = Object.entries(table(root.context));
    if (contexts.length > 32) out.limitations.push("Only the first 32 Netlify contexts were inspected.");
    const scopes = [{ config: root, prefix: [] as string[] }, ...contexts.slice(0, 32).map(([name, value]) => ({ config: table(value), prefix: ["context", name] }))];
    for (const { config, prefix } of scopes) {
      const build = table(root.build), base = string(config.base) ?? string(build.base) ?? "";
      const command = string(config.command) ?? string(build.command);
      const label = prefix.length ? ` (${prefix.join(".")})` : "";
      evaluated.add("netlify-base-directory");
      if (base && path.posix.normalize(base) !== "." && literalPath(base) && !s.partial && ![...paths].some(f => f.startsWith(path.posix.normalize(base).replace(/\/$/, "") + "/"))) add("netlify-base-directory", "netlify.toml", netlify.at([...(prefix.length && Object.hasOwn(config, "base") ? prefix : ["build"]), "base"]), `Netlify base directory ${base} is missing from this commit${label}.`, "Correct build.base/context base or commit the source directory that Netlify must enter before building.", prefix.length ? "yellow" : "red");
      evaluated.add("netlify-context-build-script");
      // Root npm run is already covered by portable-build; this extends it to contexts, monorepo bases and other managers.
      const script = command && (/^\s*(?:npm|bun|pnpm|yarn)\s+run\s+([A-Za-z0-9:_-]+)\s*$/.exec(command)?.[1] ?? /^\s*(?:pnpm|yarn)\s+(build)\s*$/.exec(command)?.[1]);
      const manifestPath = path.posix.join(base, "package.json"), raw = s.contents.get(manifestPath);
      if (script && raw && (prefix.length || base || !/^\s*npm run /.test(command!))) {
        try { const manifest = table(JSON.parse(raw)); if (!manifest.workspaces && !Object.hasOwn(table(manifest.scripts), script)) add("netlify-context-build-script", "netlify.toml", netlify.at([...(prefix.length && Object.hasOwn(config, "command") ? prefix : ["build"]), "command"]), `Netlify runs ${command}, but ${manifestPath} has no ${script} script${label}.`, `Define ${script} in ${manifestPath} or correct this context's build command.`, prefix.length ? "yellow" : "red"); } catch { /* Manifest syntax handled separately. */ }
      }
    }
    evaluated.add("netlify-forced-spa-shadow"); evaluated.add("netlify-redirect-loop");
    const redirects = array(root.redirects);
    const redirectLines = [...netlify.raw.matchAll(/^\s*\[\[redirects\]\]/gm)].map(m => netlify.raw.slice(0, m.index).split("\n").length);
    const guarded = (r: Table) => ["conditions", "query", "signed", "headers"].some(k => Object.hasOwn(r, k));
    for (const [i, rule] of redirects.entries()) {
      const from = string(rule.from), to = string(rule.to), status = rule.status ?? 301;
      const at = redirectLines[i] ?? 1;
      if (from && from.startsWith("/") && from === to && typeof status === "number" && status >= 300 && status < 400 && !guarded(rule)) add("netlify-redirect-loop", "netlify.toml", at, `Redirect ${from} points back to the same path.`, "Remove the self-redirect or point it at the intended different destination. Check shadowing and earlier rules before deploying.");
      if (from === "/*" && to === "/index.html" && status === 200 && rule.force === true && !guarded(rule) && redirects.slice(i + 1).some(r => string(r.to)?.startsWith("/.netlify/functions/") && string(r.from)?.startsWith("/"))) add("netlify-forced-spa-shadow", "netlify.toml", at, "A forced catch-all SPA rewrite appears before a function rewrite.", "Put the specific function/API rewrite before the /* SPA fallback, then test both an API request and a deep link. Earlier _redirects and edge-function rules must also be reviewed.");
    }
    evaluated.add("netlify-edge-path");
    for (const rule of array(root.edge_functions)) if (typeof rule.path === "string" && !rule.path.startsWith("/")) add("netlify-edge-path", "netlify.toml", Math.max(1, netlify.raw.slice(0, netlify.raw.indexOf("[[edge_functions]]")).split("\n").length), "An edge function path does not start with /.", "Use a URLPattern path starting with /, or configure pattern for an explicit regular expression.", "red");
  }
  for (const file of ["railway.json", "railway.toml"]) if (paths.has(file)) {
    const doc = read(file); if (!doc) continue;
    evaluated.add("railway-dockerfile-path");
    const dockerfile = string(table(doc.config.build).dockerfilePath);
    if (dockerfile && literalPath(dockerfile) && !paths.has(path.posix.normalize(dockerfile))) add("railway-dockerfile-path", file, doc.at(["build", "dockerfilePath"]), `Configured Railway Dockerfile ${dockerfile} was not found in the scanned commit.`, "Check the service root directory and Dockerfile path in Railway, then commit the file or correct the setting. Dashboard root-directory and environment overrides are not visible.");
    out.limitations.push("Railway configuration checks cover committed legacy JSON/TOML only; current service/IaC settings and deployment eligibility are not verified.");
  }
  if (paths.has(".railway/railway.ts")) out.limitations.push("Railway TypeScript Infrastructure as Code is detected but is not executed or evaluated.");
  if (s.contents.has("Dockerfile")) {
    out.filesRead.push("Dockerfile"); evaluated.add("docker-env-copy");
    for (const [i, source] of s.contents.get("Dockerfile")!.split("\n").entries()) {
      const copy = /^\s*(?:COPY|ADD)\s+(\.env(?:\.[A-Za-z0-9_-]+)?)\s+[^\s]+\s*(?:#.*)?$/i.exec(source);
      if (copy && !/\.(?:example|sample|template)$/.test(copy[1])) add("docker-env-copy", "Dockerfile", i + 1, "The image build explicitly copies an environment file into an image layer.", "Verify it contains no secrets. Prefer runtime secret injection or build secret mounts; removing the file in a later layer does not remove it from earlier layers.");
    }
  }
  const nested = [...paths].filter(f => /\/(?:wrangler\.(?:toml|jsonc?)|netlify\.toml|railway\.(?:toml|json))$/.test(f));
  if (nested.length) out.limitations.push("Nested hosting configurations are present; path-relative platform rules currently inspect root hosting configs only.");
  if (out.platforms.length) out.limitations.push("Static repository configuration only. Dashboard settings, CLI overrides, generated output, actual builds and live behavior were not verified.");
  out.evaluatedRules = [...evaluated]; out.limitations = [...new Set(out.limitations)];
  return out;
}
