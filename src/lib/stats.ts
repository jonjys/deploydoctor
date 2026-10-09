import "server-only";
import { unstable_cache } from "next/cache";
import { rpc } from "@/lib/db";

// Cached for five minutes so a busy homepage does not query the database on every visit.
// A failed query throws, and unstable_cache does not keep thrown results, so an outage is not cached.
const cachedCount = unstable_cache(
  async () => Number(await rpc<number | string>("repos_scanned", {})),
  ["repos-scanned"],
  { revalidate: 300 },
);

/**
 * Distinct repositories scanned, public and private. Null when the count is unavailable
 * (database down or the migration not applied yet); the homepage then leaves the counter out.
 */
export async function reposScanned(): Promise<number | null> {
  try {
    const count = await cachedCount();
    return Number.isFinite(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}
