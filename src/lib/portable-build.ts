import path from "node:path";
import { auditHosting, type HostingAudit } from "@/lib/hosting-config";
import { parse } from "smol-toml";
import type { RepositorySnapshot } from "@/lib/analyzer";
import type { CheckResult, Finding } from "@/types/report";
import type { Lang } from "@/lib/i18n";

type Table = Record<string, unknown>;
const table = (v: unknown): Table => v && typeof v === "object" && !Array.isArray(v) ? v as Table : {};
const line = (text: string, needle: string) => text.slice(0, Math.max(0, text.indexOf(needle))).split("\n").length;
const rootFiles = ["Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "netlify.toml", "wrangler.toml", "Dockerfile"];
/** Configuration data only. No commands, dependency downloads, build scripts or customer code execute. */
export function checkPortableBuild(s: RepositorySnapshot, lang: Lang, hosting: HostingAudit = auditHosting(s)): CheckResult | null {
  if (!rootFiles.some(f => s.entries.some(e => e.path === f)) && !hosting.platforms.some(p => p !== "Vercel") && (s.contents.has("package.json") || s.entries.some(e => /\.html$/i.test(e.path)))) return null;
  const sv = lang === "sv", findings: Finding[] = [], checked: string[] = [];
  const paths = new Set(s.entries.map(e => e.path));
  const add = (file: string, needle: string, problem: string, fix: string, status: "red" | "yellow" = "yellow", ruleId = "portable-config") => findings.push({ file, line: line(s.contents.get(file) ?? "", needle), problem, fix, status, ruleId });
  const toml = (file: string) => {
    const text = s.contents.get(file); if (text === undefined) return null;
    try { const parsed = parse(text); checked.push(file); return parsed; }
    catch { add(file, "", "Configuration is not valid TOML.", "Correct the TOML syntax, then run the production build locally.", "red", "invalid-toml"); return null; }
  };
  const cargo = toml("Cargo.toml");
  if (cargo) {
    const pkg = table(cargo.package), minimum = typeof pkg["rust-version"] === "string" ? pkg["rust-version"] : undefined;
    const minor = (version: string) => /^1\.(\d+)(?:\.\d+)?$/.exec(version)?.[1];
    const required = minimum && minor(minimum) !== undefined ? Number(minor(minimum)) : undefined;
    const edition = String(pkg.edition ?? "2015"), floor = ({ "2018": 31, "2021": 56, "2024": 85 } as Record<string, number>)[edition];
    if (required !== undefined && floor && required < floor) add("Cargo.toml", "rust-version", `Rust edition ${edition} requires Rust 1.${floor} or newer, but rust-version is ${minimum}.`, "Align rust-version and edition, then check the pinned build toolchain.", "red", "rust-edition-msrv");
    const pinned = toml("rust-toolchain.toml");
    const channel = table(pinned?.toolchain).channel ?? s.contents.get("rust-toolchain")?.trim();
    if (required !== undefined && typeof channel === "string" && minor(channel) !== undefined && Number(minor(channel)) < required) add(s.contents.has("rust-toolchain.toml") ? "rust-toolchain.toml" : "rust-toolchain", "channel", `Pinned Rust ${channel} is older than the declared minimum ${minimum}.`, "Update the pinned Rust toolchain to satisfy rust-version.", "red", "rust-toolchain-msrv");
    // An explicit target path is mandatory; omitted paths use Cargo defaults and are not inferred here.
    const targets = [table(cargo.lib), ...(Array.isArray(cargo.bin) ? cargo.bin.map(table) : [])];
    if (!s.partial) for (const target of targets) if (typeof target.path === "string" && !/[\\$*?]/.test(target.path) && !paths.has(path.posix.normalize(target.path))) add("Cargo.toml", target.path, `Explicit Cargo target ${target.path} is missing from this commit.`, "Commit the target file or correct its path and casing in Cargo.toml.", "red", "rust-target-path");
    if (!paths.has("Cargo.lock") && !s.partial) {
      const pipeline = [...s.contents].find(([file, source]) => /(?:^\.github\/workflows\/|^Dockerfile$|^netlify\.toml$|^vercel\.json$)/.test(file) && source.split("\n").some(l => !/^\s*#/.test(l) && /\bcargo\s+(?:build|check|test|run|install)\b[^\n]*(?:--locked|--frozen)\b/.test(l)));
      if (pipeline) add(pipeline[0], "--locked", "The pipeline requires a locked Cargo build, but this commit has no Cargo.lock.", "Generate and commit Cargo.lock using the intended toolchain before deploying.", "yellow", "rust-locked-build");
    }
  }
  const netlify = toml("netlify.toml");
  if (netlify) {
    const build = table(netlify.build), functions = table(netlify.functions);
    const base = typeof build.base === "string" ? build.base : "";
    const normalized = (value: string) => path.posix.normalize(path.posix.join(base, value)).replace(/\/$/, "");
    const publish = typeof build.publish === "string" ? normalized(build.publish) : null;
    const fn = typeof functions.directory === "string" ? normalized(functions.directory) : typeof build.functions === "string" ? normalized(build.functions) : normalized("netlify/functions");
    if (publish && (fn === publish || fn.startsWith(publish + "/")) && [...paths].some(p => p.startsWith(fn + "/"))) add("netlify.toml", "publish", "The Netlify functions source directory is inside the published directory.", "Move the functions source outside publish and update functions.directory to avoid publishing server source.", "yellow", "netlify-functions-publish");
    if (typeof build.command === "string") {
      const command = /^\s*npm run ([A-Za-z0-9:_-]+)\s*$/.exec(build.command);
      const manifestPath = path.posix.join(base, "package.json"), raw = s.contents.get(manifestPath);
      if (command && raw) try {
        const manifest = JSON.parse(raw);
        if (!manifest.workspaces && !(command[1] in table(manifest.scripts))) add("netlify.toml", "command", `Netlify runs npm run ${command[1]}, but ${manifestPath} has no ${command[1]} script.`, `Define the script in ${manifestPath} or correct build.command.`, "red", "netlify-missing-script");
      } catch { /* package parser owns JSON syntax */ }
    }
  }
  findings.push(...hosting.findings.filter(f => !(f.ruleId === "hosting-config-syntax" && findings.some(old => old.file === f.file && old.ruleId === "invalid-toml"))));
  checked.push(...hosting.filesRead);
  if (s.contents.has("pyproject.toml")) toml("pyproject.toml");
  for (const file of ["go.mod", "requirements.txt", "Dockerfile"]) if (s.contents.has(file)) checked.push(file);
  const status = findings.some(f => f.status === "red") ? "red" : "yellow";
  return { id: "build-config", category: "vercel", title: sv ? "Bygg- och hostingkonfiguration" : "Build and hosting configuration", status,
    explanation: findings.length ? `${findings.length} ${sv ? "konfigurationsfynd. Bygget kördes inte." : "configuration findings. The build was not executed."}` : (sv ? "Inga fel hittades av dessa begränsade konfigurationsregler. Kompilering, runtime och hosting verifierades inte." : "No issues found by these limited configuration rules. Compilation, runtime and hosting were not verified."),
    fix: findings[0]?.fix ?? (sv ? "Kör projektets riktiga produktionsbuild och tester i dess målmiljö." : "Run the project's actual production build and tests in its target environment."),
    findings, evidence: [...new Set(checked)].map(f => `${f}: configuration read`), evaluatedRules: [...hosting.evaluatedRules, "invalid-toml", ...(cargo ? ["rust-edition-msrv", "rust-toolchain-msrv", "rust-target-path", "rust-locked-build"] : []), ...(netlify ? ["netlify-functions-publish", "netlify-missing-script"] : [])] };
}

export function portableEnvironment(s: RepositorySnapshot, lang: Lang): CheckResult {
  const findings: Finding[] = [], template = s.contents.get(".env.example") ?? "";
  const documented = new Set([...template.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map(m => m[1]));
  // Only literal standard-library calls; comments, optional defaults and dynamic names are not asserted as required values.
  for (const [file, source] of s.contents) {
    if (!/\.(rs|py|go)$/.test(file) || /(?:^|\/)(?:tests?|fixtures)\//.test(file)) continue;
    const expressions = /\b(?:std::env::var|env::var|os\.getenv|os\.Getenv)\s*\(\s*"([A-Z][A-Z0-9_]+)"\s*\)/g;
    for (const match of source.matchAll(expressions)) {
      const prefix = source.slice(source.lastIndexOf("\n", match.index) + 1, match.index);
      if (/\/\/|#/.test(prefix) || documented.has(match[1])) continue;
      findings.push({ file, line: line(source, match[0]), problem: `${match[1]} is referenced but not documented in .env.example. It may be optional.`, fix: `Document ${match[1]} and verify whether production requires it. Repository scanning cannot read hosting environment values.`, status: "yellow", ruleId: "portable-env-documentation" });
    }
  }
  return { id: "env", category: "env", title: lang === "sv" ? "Miljövariabler" : "Environment variables", status: "yellow", findings,
    explanation: findings.length ? `${findings.length} environment references need review.` : "Limited literal environment-reference checks performed. Production values and dynamic references were not verified.",
    fix: findings[0]?.fix ?? "Verify production environment variables in the hosting provider.", evidence: findings.map(f => `${f.file}:${f.line} → ${f.problem}`) };
}
