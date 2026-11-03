import { hostingPlatforms } from "@/lib/hosting-targets";
import type { Category } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

export type Stack = {
  hasPackageJson: boolean;
  languages?: string[];
  platforms?: string[];
  hasNext: boolean;
  nextVersion?: string;
  hasSupabase: boolean;
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasTailwind: boolean;
  /** A framework other than Next.js at the root, so the report can name it. Absent on older reports and for Next.js apps. */
  framework?: Framework;
};

export type Framework = "sveltekit" | "astro" | "remix" | "react-router" | "vite";
const FRAMEWORK_NAMES: Record<Framework, string> = { sveltekit: "SvelteKit", astro: "Astro", remix: "Remix", "react-router": "React Router", vite: "Vite" };

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const SUPABASE_PACKAGE = /^@supabase\//;
const SUPABASE_ENV = /(?:^|[^A-Za-z0-9_])(?:NEXT_PUBLIC_)?SUPABASE_[A-Z0-9_]+/m;
const SUPABASE_SOURCE = /from\s+["']@supabase\/|require\(\s*["']@supabase\/|process\.env\.(?:NEXT_PUBLIC_)?SUPABASE_/;

function parseManifest(text?: string | null): Manifest | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

/**
 * Pure stack detection. Pre-scan callers only have package.json and .env.example; the analyzer also
 * passes source text, which catches Supabase used through env vars or imports without a root dependency.
 */
export function detectStack(input: { packageJson?: string | null; envText?: string | null; sources?: Iterable<string>; files?: Iterable<string>; cargoToml?: string | null }): Stack {
  const files = new Set(input.files ?? []);
  const languages = [...(input.cargoToml || files.has("Cargo.toml") || [...files].some(f => /\.rs$/.test(f)) ? ["Rust"] : []), ...(files.has("go.mod") ? ["Go"] : []), ...(files.has("pyproject.toml") || files.has("requirements.txt") ? ["Python"] : []), ...(input.packageJson ? ["JavaScript / TypeScript"] : [])];
  for (const [name, extension] of [["Java", /\.java$/], ["C#", /\.cs$/], ["Ruby", /\.rb$/], ["PHP", /\.php$/], ["Swift", /\.swift$/], ["Kotlin", /\.kt$/], ["C / C++", /\.(?:c|cpp|h)$/]] as const) if ([...files].some(f => extension.test(f))) languages.push(name);
  const platforms = hostingPlatforms(files);
  const manifest = parseManifest(input.packageJson);
  const packages: Record<string, string> = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const names = Object.keys(packages);
  let hasSupabase = names.some((name) => SUPABASE_PACKAGE.test(name)) || SUPABASE_ENV.test(input.envText ?? "");
  if (!hasSupabase && input.sources) {
    for (const source of input.sources) {
      if (SUPABASE_SOURCE.test(source)) { hasSupabase = true; break; }
    }
  }
  // The first match wins: SvelteKit, Astro, Remix and React Router all build with Vite.
  const framework = "next" in packages ? undefined
    : "@sveltejs/kit" in packages ? "sveltekit"
    : "astro" in packages ? "astro"
    : "@remix-run/dev" in packages || "@remix-run/react" in packages ? "remix"
    : "@react-router/dev" in packages ? "react-router"
    : "vite" in packages ? "vite" : undefined;
  return {
    hasPackageJson: Boolean(manifest),
    languages, platforms,
    hasNext: "next" in packages,
    nextVersion: packages.next,
    hasSupabase,
    hasPrisma: "prisma" in packages || "@prisma/client" in packages,
    hasDrizzle: "drizzle-orm" in packages || "drizzle-kit" in packages,
    hasTailwind: "tailwindcss" in packages,
    ...(framework ? { framework } : {}),
  };
}

/** Which categories are pre-ticked. Vercel and env checks apply to every JavaScript project. */
export function defaultChecks(stack: Stack): Category[] {
  const checks: Category[] = [];
  // Without a readable package.json, keep the Next.js check so the user is told about it.
  if (stack.hasNext) checks.push("next");
  checks.push("vercel", "env");
  if (stack.hasSupabase) checks.push("supabase");
  if (stack.hasPrisma || stack.hasDrizzle) checks.push("prisma");
  return checks;
}

export function frameworkName(framework: Framework): string {
  return FRAMEWORK_NAMES[framework];
}

function nextMajor(version?: string) {
  return version?.match(/\d+/)?.[0];
}

export function describeStack(stack: Stack, lang: Lang = "en"): string {
  if (!stack.hasPackageJson) return [...(stack.languages ?? []), ...(stack.platforms ?? [])].join(", ") || (lang === "sv" ? "Allmänna repokontroller. Stacken identifieras under skanning." : "General repository checks. Stack identified during scan.");
  const found: string[] = [...(stack.platforms ?? [])];
  if (stack.hasNext) found.push(`Next.js${nextMajor(stack.nextVersion) ? ` ${nextMajor(stack.nextVersion)}` : ""}`);
  if (stack.framework) found.push(frameworkName(stack.framework));
  if (stack.hasTailwind) found.push("Tailwind");
  if (stack.hasPrisma) found.push("Prisma");
  if (stack.hasDrizzle) found.push("Drizzle");
  if (stack.hasSupabase) found.push("Supabase");
  const missing = !stack.hasSupabase ? t(lang, "stack.noSupabase") : !(stack.hasPrisma || stack.hasDrizzle) ? t(lang, "stack.noDb") : "";
  return [found.join(", ") || t(lang, "stack.noFramework"), missing].filter(Boolean).join(" - ");
}
