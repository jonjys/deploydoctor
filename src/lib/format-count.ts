import type { Lang } from "@/lib/i18n";

/** 1234 → "1,234" in English and "1 234" in Swedish. */
export function formatCount(lang: Lang, count: number): string {
  return new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-US").format(count);
}
