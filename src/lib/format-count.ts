import type { Lang } from "@/lib/i18n";

/** 1234 → "1,234" in English and "1 234" in Swedish. */
export function formatCount(lang: Lang, count: number): string {
  return new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-US").format(count);
}

/** The homepage shows the repos-scanned counter only from this many repositories; a small number reads as unproven. */
export const MIN_REPOS_SHOWN = 100;

/** The count to show, or null while it is unknown or below MIN_REPOS_SHOWN. */
export function shownCount(count: number | null): number | null {
  return count !== null && Number.isFinite(count) && count >= MIN_REPOS_SHOWN ? count : null;
}
