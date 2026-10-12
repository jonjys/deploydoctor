import "server-only";
import { unstable_cache } from "next/cache";
import { rpc } from "@/lib/db";
import { MIN_FIXES_SHOWN, shownCount } from "@/lib/format-count";

// Cached for five minutes so a busy homepage does not query the database on every visit.
// A failed query throws, and unstable_cache does not keep thrown results, so an outage is not cached.
const cachedCount = unstable_cache(
  async () => Number(await rpc<number | string>("repos_scanned", {})),
  ["repos-scanned"],
  { revalidate: 300 },
);

/**
 * Distinct repositories scanned, public and private. Null when the count is unavailable
 * (database down) or still below MIN_REPOS_SHOWN; the homepage then leaves the counter out.
 */
export async function reposScanned(): Promise<number | null> {
  try {
    return shownCount(await cachedCount());
  } catch {
    return null;
  }
}

const cachedFixes = unstable_cache(
  async () => Number(await rpc<number | string>("fixes_confirmed", {})),
  ["fixes-confirmed"],
  { revalidate: 300 },
);

/** Distinct visitors who said DeployDoctor solved it. Null when unavailable or below MIN_FIXES_SHOWN. */
export async function fixesConfirmed(): Promise<number | null> {
  try {
    const count = await cachedFixes();
    return Number.isFinite(count) && count >= MIN_FIXES_SHOWN ? count : null;
  } catch {
    return null;
  }
}
