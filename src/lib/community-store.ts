import "server-only";
import { rpc } from "@/lib/db";
import type { CommunitySummary } from "@/lib/community-review";

export async function communitySummary(): Promise<CommunitySummary | null> {
  try { return await rpc<CommunitySummary>("community_review_summary", {}); }
  catch { return null; }
}
