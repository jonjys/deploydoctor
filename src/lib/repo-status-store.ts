import "server-only";
import { unstable_cache } from "next/cache";
import { db, query } from "@/lib/db";
import { statusFilter } from "@/lib/repo-status";
import type { StoredReport } from "@/types/report";

/** Public reports only. A badge view never calls GitHub, reserves a scan or runs the analyzer. */
export const latestPublicRepoReport = unstable_cache(async (owner: string, name: string): Promise<StoredReport | null> => {
  const filter = statusFilter(owner, name);
  if (!filter) return null;
  const rows = await db<StoredReport[]>(query("reports", filter));
  return rows[0] ?? null;
}, ["latest-public-repo-status-v1"], { revalidate: 60 });
