import type { Category, CheckId, CheckResult } from "@/types/report";

export const CATEGORIES: readonly Category[] = ["next", "vercel", "env", "supabase", "prisma"];

const CATEGORY_OF_CHECK: Record<CheckId, Category> = {
  "next-entry": "next",
  imports: "next",
  "server-libs": "vercel",
  env: "env",
  supabase: "supabase",
  prisma: "prisma",
};

export function categoryOf(check: Pick<CheckResult, "id" | "category">): Category {
  return check.category ?? CATEGORY_OF_CHECK[check.id];
}

/** Returns undefined when the client sent nothing (auto mode), null when the value is invalid. */
export function parseChecks(input: unknown): Category[] | undefined | null {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length === 0 || input.length > CATEGORIES.length) return null;
  const known = new Set<string>(CATEGORIES);
  if (!input.every((item) => typeof item === "string" && known.has(item))) return null;
  const chosen = new Set(input as Category[]);
  return CATEGORIES.filter((category) => chosen.has(category));
}
