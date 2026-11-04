import type { RepositorySnapshot } from "@/lib/analyzer";
import { moduleImports, packageName } from "@/lib/dependencies";
import { nodeRangeAllowsMajor } from "@/lib/node-range";
import { applyVerifiedDiff, sourceHash, verifiedFileDiff } from "@/lib/patch/case-patch";
import { planCasePatch } from "@/lib/patch/plan";
import { findSecrets } from "@/lib/secrets";

export type FixLabel = "verified" | "instructions";
export type DeployFix = { id: string; label: FixLabel; file?: string; summary: string };
export type DeployPlan = {
  patch: string;
  files: string[];
  sourceHashes: Record<string, string>;
  fixes: DeployFix[];
  notes: string;
};

const SUPPORTED = [20, 22, 24];
const NODE_PIN = "22.x";
const SECRETISH = /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|DATABASE|SERVICE_KEY/i;
const PUBLISHABLE = /ANON|PUBLISHABLE/;
const BUILTIN = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA", "CI", "NODE_OPTIONS"]);
const NODE_BUILTINS = new Set(["fs", "path", "url", "http", "https", "crypto", "os", "stream", "util", "events", "buffer", "child_process", "net", "tls", "zlib", "assert", "process", "module"]);
const LOCKFILE = /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock)$/;
const SOURCE = /\.[cm]?[jt]sx?$/;
const PKG_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: { node?: unknown };
};

/**
 * Builds one verified patch for the deploy failures that can be checked from the snapshot.
 * A change that does not survive its own check is dropped. Dashboard-only steps stay labeled
 * instructions and never pretend to be a code change. An empty plan is not offered for sale.
 */
export function planDeployFixes(snapshot: RepositorySnapshot): DeployPlan {
  const original = new Map(snapshot.contents);
  const working = new Map(snapshot.contents);
  const fixes: DeployFix[] = [];
  const notes: string[] = [];

  try {
    const imports = planCasePatch({ ...snapshot, contents: working });
    for (const file of imports.files) {
      const diff = imports.patch.split(/(?=^diff --git )/m).find((part) => part.startsWith(`diff --git a/${file} b/${file}\n`));
      const source = working.get(file);
      if (!diff || source === undefined) continue;
      working.set(file, applyVerifiedDiff(file, source, diff));
      fixes.push({ id: "import-case", label: "verified", file, summary: `${file}: import letter case corrected so Linux can find the file.` });
    }
  } catch { /* an unverifiable import patch is omitted, not sold */ }

  fixEnv(original, working, snapshot, fixes, notes);
  fixNode(working, snapshot, fixes);
  fixVercel(working, snapshot, fixes, notes);
  fixDependencies(working, snapshot, fixes, notes);
  fixSupabaseLocalhost(working, snapshot, fixes, notes);

  if (notes.length && ![...working.keys()].some((file) => working.get(file) !== original.get(file)) && !working.has("deploydoctor-fix.md")) {
    working.set("deploydoctor-fix.md", `DeployDoctor fix\n\nThese steps are instructions. They do not change the build by themselves.\n\n${notes.map((note) => `- ${note}`).join("\n")}\n`);
    fixes.push({ id: "instructions", label: "instructions", file: "deploydoctor-fix.md", summary: "Dashboard steps are written in deploydoctor-fix.md. They are not a code change." });
  }

  const changed = [...working.keys()].filter((file) => working.get(file) !== original.get(file)).sort();
  const diffs: string[] = [];
  const files: string[] = [];
  const sourceHashes: Record<string, string> = {};
  for (const file of changed) {
    const before = original.get(file) ?? "";
    const after = working.get(file) ?? "";
    if (!after.endsWith("\n") || (before !== "" && !before.endsWith("\n"))) continue;
    try {
      const diff = verifiedFileDiff(file, before, after);
      if (!diff || applyVerifiedDiff(file, before, diff) !== after) continue;
      diffs.push(diff);
      files.push(file);
      sourceHashes[file] = sourceHash(before);
    } catch { /* this file is left out of the paid patch */ }
  }
  const kept = new Set(files);
  const sold = fixes.filter((fix) => !fix.file || kept.has(fix.file) || fix.label === "instructions");
  const patch = diffs.join("");
  if (!files.length || !sold.some((fix) => fix.label === "verified" || fix.label === "instructions") || Buffer.byteLength(patch) > 24_000 || files.length > 12) {
    return { patch: "", files: [], sourceHashes: {}, fixes: [], notes: "" };
  }
  return { patch, files, sourceHashes, fixes: sold, notes: notes.join("\n") };
}

function readJson(source: string | undefined): { raw: string; value: Manifest } | null {
  if (!source) return null;
  try { return { raw: source, value: JSON.parse(source) as Manifest }; } catch { return null; }
}

function packagesOf(manifest: Manifest): Record<string, string> {
  return { ...manifest.devDependencies, ...manifest.dependencies };
}

function clientPrefix(snapshot: RepositorySnapshot): "NEXT_PUBLIC_" | "VITE_" | null {
  const manifest = readJson(snapshot.contents.get("package.json"));
  const packages = manifest ? packagesOf(manifest.value) : {};
  if (packages.next || snapshot.entries.some((entry) => entry.path === "app" || entry.path.startsWith("app/") || entry.path.startsWith("src/app/") || entry.path.startsWith("pages/"))) return "NEXT_PUBLIC_";
  if (packages.vite) return "VITE_";
  return null;
}

function isClientFile(file: string, source: string): boolean {
  if (/^\s*["']use client["']/.test(source) || source.includes("import.meta.env.")) return true;
  return /\/components\//.test(file) && !/\/api\//.test(file) && !file.endsWith("route.ts");
}

function fixEnv(original: Map<string, string>, working: Map<string, string>, snapshot: RepositorySnapshot, fixes: DeployFix[], notes: string[]) {
  const prefix = clientPrefix(snapshot);
  const declared = new Set<string>();
  const examplePath = ".env.example";
  const example = working.get(examplePath) ?? "";
  for (const line of example.split("\n")) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name) declared.add(name);
  }
  const additions: string[] = [];
  for (const [file, source] of [...working]) {
    if (!SOURCE.test(file) || !isClientFile(file, source) || !prefix) continue;
    let next = source;
    const reads = [...source.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)/g)];
    for (const read of reads) {
      const name = read[1];
      if (BUILTIN.has(name) || name.startsWith("NEXT_PUBLIC_") || name.startsWith("VITE_")) continue;
      if (SECRETISH.test(name) && !PUBLISHABLE.test(name)) {
        notes.push(`${file} reads ${name} in client code. Move that read to a server route. It was not renamed, because the name looks like a secret.`);
        continue;
      }
      const publicName = `${prefix}${name}`;
      next = next.replaceAll(`${read[0].startsWith("import") ? "import.meta.env" : "process.env"}.${name}`, `${read[0].startsWith("import") ? "import.meta.env" : "process.env"}.${publicName}`);
      if (!declared.has(publicName)) additions.push(`${publicName}=`);
      declared.add(publicName);
    }
    if (next !== source && !next.includes("\0")) {
      working.set(file, next.endsWith("\n") || source === "" ? next : `${next}\n`);
      fixes.push({ id: "env-prefix", label: "verified", file, summary: `${file}: client env reads now use ${prefix}. Set the same names in the host.` });
    }
  }
  for (const [file, source] of working) {
    if (!SOURCE.test(file)) continue;
    for (const read of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!BUILTIN.has(read[1]) && !declared.has(read[1])) additions.push(`${read[1]}=`);
      declared.add(read[1]);
    }
  }
  const unique = [...new Set(additions)].filter((line) => !findSecrets(line).length);
  if (!unique.length) return;
  const current = working.get(examplePath) ?? "";
  const base = current.endsWith("\n") || current === "" ? current : `${current}\n`;
  const cleaned = base.split("\n").map((line) => findSecrets(line).length ? line.replace(/=.*$/, "=") : line).join("\n");
  working.set(examplePath, `${cleaned.replace(/\n+$/, cleaned ? "\n" : "")}${unique.join("\n")}\n`.replace(/^\n/, ""));
  if ((working.get(examplePath) ?? "").includes("\n\n\n")) working.set(examplePath, (working.get(examplePath) ?? "").replace(/\n{3,}/g, "\n\n"));
  const written = working.get(examplePath) ?? "";
  if (unique.every((line) => written.includes(line)) && !findSecrets(written).length) {
    fixes.push({ id: "env-example", label: "verified", file: examplePath, summary: `${examplePath}: empty placeholders for ${unique.map((line) => line.replace(/=$/, "")).join(", ")}. Values stay in the host, not in git.` });
  } else working.set(examplePath, original.get(examplePath) ?? "");
  const gitignore = working.get(".gitignore");
  if (gitignore && !original.has(examplePath) && /^\s*\.env/m.test(gitignore) && !gitignore.includes("!.env.example")) {
    const next = gitignore.endsWith("\n") ? `${gitignore}!.env.example\n` : `${gitignore}\n!.env.example\n`;
    working.set(".gitignore", next);
    fixes.push({ id: "env-gitignore", label: "verified", file: ".gitignore", summary: ".gitignore keeps .env.example in the repository with !.env.example." });
  }
}

function fixNode(working: Map<string, string>, snapshot: RepositorySnapshot, fixes: DeployFix[]) {
  if (snapshot.contents.has("netlify.toml") || snapshot.contents.has("wrangler.toml")) return;
  const parsed = readJson(working.get("package.json"));
  if (!parsed) return;
  const node = parsed.value.engines?.node;
  const range = typeof node === "string" ? node : "";
  const allows = range ? nodeRangeAllowsMajor(range, SUPPORTED) : null;
  const nvmText = working.get(".nvmrc") ?? snapshot.contents.get(".nvmrc") ?? "";
  const nvmMajor = /^v?(\d+)/.exec(nvmText.trim())?.[1];
  const nvmBad = Boolean(nvmMajor && !SUPPORTED.includes(Number(nvmMajor)));
  if (allows !== false && !nvmBad) return;
  let nextRaw = working.get("package.json") ?? "";
  if (range && allows === false) {
    const match = /("engines"\s*:\s*\{[^}]*"node"\s*:\s*")([^"]+)(")/.exec(nextRaw);
    if (!match || match[2] !== range) return;
    nextRaw = nextRaw.slice(0, match.index) + match[1] + NODE_PIN + match[3] + nextRaw.slice(match.index + match[0].length);
  } else if (!range && nvmBad) {
    parsed.value.engines = { ...parsed.value.engines, node: NODE_PIN };
    nextRaw = `${JSON.stringify(parsed.value, null, 2)}\n`;
  } else return;
  if (!nextRaw.endsWith("\n")) nextRaw += "\n";
  const again = readJson(nextRaw);
  if (!again || nodeRangeAllowsMajor(String(again.value.engines?.node ?? ""), SUPPORTED) !== true) return;
  working.set("package.json", nextRaw);
  if (!nvmText || nvmBad) working.set(".nvmrc", "22\n");
  fixes.push({ id: "node", label: "verified", file: "package.json", summary: "engines.node is pinned to 22.x, a Node version Vercel can build. .nvmrc says 22." });
}

function fixVercel(working: Map<string, string>, snapshot: RepositorySnapshot, fixes: DeployFix[], notes: string[]) {
  const parsed = readJson(working.get("package.json"));
  const packages = parsed ? packagesOf(parsed.value) : {};
  const vercelRaw = working.get("vercel.json");
  let vercel: Record<string, unknown> | null = null;
  if (vercelRaw) { try { vercel = JSON.parse(vercelRaw) as Record<string, unknown>; } catch { vercel = null; } }

  if (packages.next && vercel && vercel.framework !== undefined && vercel.framework !== "nextjs") {
    vercel.framework = "nextjs";
    const next = `${JSON.stringify(vercel, null, 2)}\n`;
    const check = JSON.parse(next) as { framework?: string };
    if (check.framework === "nextjs") {
      working.set("vercel.json", next);
      fixes.push({ id: "vercel-framework", label: "verified", file: "vercel.json", summary: "vercel.json framework is nextjs, so Vercel builds this Next app instead of serving another preset." });
    }
  }

  if (packages.next && parsed && !parsed.value.scripts?.build && !vercel?.buildCommand && !("workspaces" in (parsed.value as object))) {
    const value = parsed.value;
    value.scripts = { ...value.scripts, build: "next build" };
    const next = `${JSON.stringify(value, null, 2)}\n`;
    const check = readJson(next);
    if (check?.value.scripts?.build === "next build") {
      working.set("package.json", next);
      fixes.push({ id: "build-script", label: "verified", file: "package.json", summary: "package.json scripts.build is next build, which Vercel runs when no other build command is set." });
    }
  }

  const viteSpa = Boolean(packages.vite && !packages.next && vercelRaw === undefined && !snapshot.entries.some((entry) => entry.path.startsWith("app/") || entry.path.startsWith("pages/")));
  if (viteSpa) {
    const next = `${JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }, null, 2)}\n`;
    working.set("vercel.json", next);
    fixes.push({ id: "vercel-spa", label: "verified", file: "vercel.json", summary: "vercel.json rewrites deep links to index.html so a Vite single-page app does not 404 on Vercel." });
  }

  for (const [file, source] of working) {
    if (!/^next\.config\.[cm]?[jt]s$/.test(file)) continue;
    if (/output\s*:\s*['"]export['"]/.test(source)) {
      notes.push(`${file} sets output: "export". Remove it only if this app should run as a Vercel server. It was not changed automatically.`);
    }
  }
}

function fixDependencies(working: Map<string, string>, snapshot: RepositorySnapshot, fixes: DeployFix[], notes: string[]) {
  const parsed = readJson(working.get("package.json"));
  if (!parsed) return;
  const declared = new Set<string>([
    ...Object.keys(parsed.value.dependencies ?? {}),
    ...Object.keys(parsed.value.devDependencies ?? {}),
    ...Object.keys(parsed.value.peerDependencies ?? {}),
    ...Object.keys(parsed.value.optionalDependencies ?? {}),
  ]);
  const missing = new Set<string>();
  for (const [file, source] of working) {
    if (!SOURCE.test(file)) continue;
    for (const use of moduleImports(source, file)) {
      if (use.kind !== "static") continue;
      const name = packageName(use.specifier);
      if (!name || declared.has(name) || NODE_BUILTINS.has(name) || name.startsWith("node:") || !PKG_NAME.test(name)) continue;
      missing.add(name);
    }
  }
  const lock = snapshot.entries.some((entry) => LOCKFILE.test(entry.path));
  const names = [...missing].sort().slice(0, 8);
  if (!names.length) return;
  if (lock) {
    notes.push(`These imports are not in package.json: ${names.join(", ")}. A lockfile is committed, so it was not edited. Run the install command for your package manager, then commit package.json and the lockfile.`);
    fixes.push({ id: "dependency", label: "instructions", summary: `Missing packages ${names.join(", ")} need an install so the lockfile matches. The lockfile was not rewritten.` });
    return;
  }
  parsed.value.dependencies = { ...parsed.value.dependencies };
  for (const name of names) parsed.value.dependencies[name] = "*";
  const next = `${JSON.stringify(parsed.value, null, 2)}\n`;
  const check = readJson(next);
  if (!check || names.some((name) => !check.value.dependencies?.[name])) return;
  working.set("package.json", next);
  fixes.push({ id: "dependency", label: "verified", file: "package.json", summary: `package.json now depends on ${names.join(", ")}. No lockfile was committed, so the installer resolves the version. There is no lockfile drift to repair.` });
}

function fixSupabaseLocalhost(working: Map<string, string>, snapshot: RepositorySnapshot, fixes: DeployFix[], notes: string[]) {
  const usesSupabase = [...working.values()].some((source) => source.includes("@supabase/") || source.includes("supabase"));
  if (!usesSupabase && !snapshot.entries.some((entry) => entry.path.startsWith("supabase/"))) return;
  for (const [file, source] of [...working]) {
    if (!SOURCE.test(file)) continue;
    const match = /redirectTo\s*:\s*(['"])(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(\/[^'"]*)?\1/.exec(source);
    if (!match) continue;
    const path = match[3] ?? "";
    const next = source.replace(match[0], `redirectTo: \`\${window.location.origin}${path}\``);
    if (next === source || /localhost|127\.0\.0\.1/.test(next.slice(Math.max(0, match.index - 20), match.index + 80))) continue;
    working.set(file, next.endsWith("\n") ? next : `${next}\n`);
    fixes.push({ id: "supabase-localhost", label: "verified", file, summary: `${file}: auth redirect uses the browser origin instead of localhost.` });
  }
  const config = working.get("supabase/config.toml");
  if (config && /site_url\s*=\s*["']https?:\/\/(?:localhost|127\.0\.0\.1)/.test(config)) {
    notes.push("supabase/config.toml site_url points at localhost. In the Supabase dashboard, set Site URL and Redirect URLs to the https Vercel domain. The file was not rewritten, because the production URL is not in the repository.");
    fixes.push({ id: "supabase-site-url", label: "instructions", file: "supabase/config.toml", summary: "Supabase Site URL still points at localhost. Set it in the Supabase dashboard. No production URL was invented." });
  }
}
