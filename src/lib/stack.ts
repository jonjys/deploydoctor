import type { Category } from "@/types/report";
import { t, type Lang } from "@/lib/i18n";

export type Stack = {
  hasPackageJson: boolean;
  hasNext: boolean;
  nextVersion?: string;
  hasSupabase: boolean;
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasTailwind: boolean;
};

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
export function detectStack(input: { packageJson?: string | null; envText?: string | null; sources?: Iterable<string> }): Stack {
  const manifest = parseManifest(input.packageJson);
  const packages: Record<string, string> = { ...manifest?.devDependencies, ...manifest?.dependencies };
  const names = Object.keys(packages);
  let hasSupabase = names.some((name) => SUPABASE_PACKAGE.test(name)) || SUPABASE_ENV.test(input.envText ?? "");
  if (!hasSupabase && input.sources) {
    for (const source of input.sources) {
      if (SUPABASE_SOURCE.test(source)) { hasSupabase = true; break; }
    }
  }
  return {
    hasPackageJson: Boolean(manifest),
    hasNext: "next" in packages,
    nextVersion: packages.next,
    hasSupabase,
    hasPrisma: "prisma" in packages || "@prisma/client" in packages,
    hasDrizzle: "drizzle-orm" in packages || "drizzle-kit" in packages,
    hasTailwind: "tailwindcss" in packages,
  };
}

/** Which categories are pre-ticked. Vercel and env checks apply to every JavaScript project. */
export function defaultChecks(stack: Stack): Category[] {
  const checks: Category[] = [];
  // Without a readable package.json, keep the Next.js check so the user is told about it.
  if (stack.hasNext || !stack.hasPackageJson) checks.push("next");
  checks.push("vercel", "env");
  if (stack.hasSupabase) checks.push("supabase");
  if (stack.hasPrisma || stack.hasDrizzle) checks.push("prisma");
  return checks;
}

function nextMajor(version?: string) {
  return version?.match(/\d+/)?.[0];
}

export function describeStack(stack: Stack, lang: Lang = "en"): string {
  if (!stack.hasPackageJson) return t(lang, "stack.noPackage");
  const found: string[] = [];
  if (stack.hasNext) found.push(`Next.js${nextMajor(stack.nextVersion) ? ` ${nextMajor(stack.nextVersion)}` : ""}`);
  if (stack.hasTailwind) found.push("Tailwind");
  if (stack.hasPrisma) found.push("Prisma");
  if (stack.hasDrizzle) found.push("Drizzle");
  if (stack.hasSupabase) found.push("Supabase");
  const missing = !stack.hasSupabase ? t(lang, "stack.noSupabase") : !(stack.hasPrisma || stack.hasDrizzle) ? t(lang, "stack.noDb") : "";
  return [found.join(", ") || t(lang, "stack.noFramework"), missing].filter(Boolean).join(" - ");
}
