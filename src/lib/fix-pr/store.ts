import "server-only";
import { createHash } from "node:crypto";
import { db, query, rpc } from "@/lib/db";
import { FIX_PROMO_CAP } from "@/lib/fix-pr/constants";
import { rescueEntry, type RescueEntry } from "@/lib/fix-pr/wall";

type PromoRow = { granted?: boolean; claimed?: number; cap?: number; remaining?: number };

function first(value: PromoRow | PromoRow[] | null): PromoRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Remaining free launch fixes. Null when the counter cannot be read, which means checkout charges. */
export async function promoRemaining(): Promise<number | null> {
  try {
    const row = first(await rpc<PromoRow | PromoRow[]>("fix_promo_remaining", {}));
    const remaining = row?.remaining;
    return typeof remaining === "number" && remaining >= 0 && remaining <= FIX_PROMO_CAP ? remaining : null;
  } catch { return null; }
}

/** One launch slot per repository commit, however many times it is diagnosed. */
export function promoKey(repoUrl: string, commitSha: string): string {
  return createHash("sha256").update(`fix-promo:${repoUrl.toLowerCase()}@${commitSha}`).digest("hex");
}

/** Gives a slot back when the pull request could not be opened. */
export async function releasePromo(key: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) return;
  await rpc("release_fix_promo", { p_quote_hash: key }).catch(() => console.error("Fix promo slot was not released"));
}

/** Atomically takes one free slot for this key. The same key does not consume a second slot. */
export async function claimPromo(quoteHash: string): Promise<{ granted: boolean; claimed: number }> {
  if (!/^[a-f0-9]{64}$/.test(quoteHash)) return { granted: false, claimed: FIX_PROMO_CAP };
  try {
    const row = first(await rpc<PromoRow | PromoRow[]>("claim_fix_promo", { p_quote_hash: quoteHash }));
    if (!row || row.granted !== true || typeof row.claimed !== "number") return { granted: false, claimed: typeof row?.claimed === "number" ? row.claimed : FIX_PROMO_CAP };
    return { granted: true, claimed: row.claimed };
  } catch { return { granted: false, claimed: FIX_PROMO_CAP }; }
}

export type FixOrder = {
  repo_url: string; commit_sha: string; status: "paid" | "opened" | "passed" | "failed" | "refunded";
  promo: boolean; amount_minor: number; stripe_session_id: string; payment_intent_id?: string | null;
  pr_url?: string | null; head_sha?: string | null; error_summary?: string | null; live_url?: string | null;
  consent: boolean; refund_id?: string | null; is_private?: boolean;
};

const ORDER_FIELDS = "repo_url,commit_sha,status,promo,amount_minor,stripe_session_id,payment_intent_id,pr_url,head_sha,consent,live_url,error_summary,is_private";

/**
 * Status only moves forward: opened → passed or failed → refunded. A refunded order is never reopened or shown
 * on the Rescue Wall, and a passed one is never refunded by a later event.
 */
const FROM: Record<FixOrder["status"], FixOrder["status"][]> = { paid: ["paid"], opened: ["paid", "opened"], passed: ["opened"], failed: ["opened"], refunded: ["paid", "opened", "failed"] };
export async function markFixOrder(sessionId: string, patch: Partial<Pick<FixOrder, "status" | "pr_url" | "refund_id" | "head_sha">>): Promise<void> {
  if (!sessionId || sessionId.length > 120) return;
  const filter: Record<string, string> = { stripe_session_id: `eq.${sessionId}` };
  if (patch.status) filter.status = `in.(${FROM[patch.status].join(",")})`;
  await db(query("fix_orders", filter), { method: "PATCH", body: JSON.stringify(patch) });
}

export async function fixOrderBySession(sessionId: string): Promise<FixOrder | null> {
  if (!/^(?:cs_(?:live|test)_|promo_)[A-Za-z0-9_]{10,200}$/.test(sessionId)) return null;
  const rows = await db<FixOrder[]>(query("fix_orders", { select: ORDER_FIELDS, stripe_session_id: `eq.${sessionId}`, limit: "1" }));
  return rows?.[0] ?? null;
}

/** Orders whose pull request head is this commit: DeployDoctor's own fix commit. */
export async function fixOrdersByHeadSha(sha: string): Promise<FixOrder[]> {
  if (!/^[a-f0-9]{40}$/.test(sha)) return [];
  return await db<FixOrder[]>(query("fix_orders", { select: ORDER_FIELDS, head_sha: `eq.${sha}`, limit: "5" })) ?? [];
}

export async function fixOrderByPullRequest(prUrl: string): Promise<FixOrder | null> {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(prUrl)) return null;
  const rows = await db<FixOrder[]>(query("fix_orders", { select: ORDER_FIELDS, pr_url: `eq.${prUrl}`, limit: "1" }));
  return rows?.[0] ?? null;
}

export async function saveFixOrder(order: FixOrder): Promise<void> {
  await db("fix_orders?on_conflict=stripe_session_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(order),
  });
}

export async function listRescueWall(): Promise<RescueEntry[]> {
  try {
    const rows = await db<Array<{ repo_url: string; error_summary: string | null; live_url: string | null; pr_url: string | null; created_at: string }>>(
      query("fix_orders", { select: "repo_url,error_summary,live_url,pr_url,created_at", status: "eq.passed", consent: "eq.true", is_private: "eq.false", order: "created_at.desc", limit: "50" }));
    return (rows ?? []).flatMap((row) => {
      const entry = rescueEntry({
        consent: true, isPrivate: false, repo: row.repo_url, error: row.error_summary ?? "",
        liveUrl: row.live_url ?? "", prUrl: row.pr_url ?? "", fixedAt: row.created_at,
      });
      return entry ? [entry] : [];
    });
  } catch { return []; }
}
