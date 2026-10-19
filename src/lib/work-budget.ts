import "server-only";
import { rpc } from "@/lib/db";
import { digest } from "@/lib/session-token";
import { t, type Lang } from "@/lib/i18n";
import type { BudgetRule } from "@/lib/budget-policy";

export class WorkLimitError extends Error {
  constructor(public readonly retryAfter: number) { super("Work budget exhausted."); }
}
/** Atomic in Postgres across every server instance. Counts attempts; failures cannot reset a spend budget. */
export async function acquireWork(rules: BudgetRule[], concurrencyKey?: string, concurrencyLimit = 1, leaseSeconds = 90): Promise<string | null> {
  const result = await rpc<{ allowed: boolean; retryAfter?: number; lease?: string }>("acquire_work_budget", {
    p_rules: rules.map(rule => ({ ...rule, key: digest(`budget:${rule.key}`) })),
    p_concurrency_key: concurrencyKey ? digest(`lease:${concurrencyKey}`) : null,
    p_concurrency_limit: concurrencyLimit, p_lease_seconds: leaseSeconds,
  });
  if (!result.allowed) throw new WorkLimitError(Math.max(1, result.retryAfter ?? 60));
  return result.lease ?? null;
}
export async function releaseWork(id: string) {
  await rpc("release_work_budget", { p_id: id }).catch(() => console.error("Work lease release failed; it will expire."));
}
export function workLimitResponse(error: unknown, lang: Lang): Response | null {
  if (!(error instanceof WorkLimitError)) return null;
  return Response.json({ error: t(lang, "err.workLimit"), retryAfter: error.retryAfter }, {
    status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" },
  });
}
