export type BuildOutcome = "passed" | "failed" | "pending";

/** Vercel reports each deployment as a commit status whose context starts with "Vercel". */
const VERCEL = /^vercel\b/i;

/**
 * The build result of a fix commit, from Vercel's commit statuses only. Checks the buyer adds (their own CI,
 * comment bots) never decide a refund or the Rescue Wall. No Vercel status yet means pending, never failed.
 */
export function vercelOutcome(statuses: Array<{ context?: string | null; state?: string | null }>): BuildOutcome {
  const vercel = statuses.filter((status) => VERCEL.test(status.context ?? ""));
  if (!vercel.length) return "pending";
  const states = vercel.map((status) => (status.state ?? "").toLowerCase());
  if (states.some((state) => state === "pending" || state === "")) return "pending";
  if (states.some((state) => state === "failure" || state === "error")) return "failed";
  return states.every((state) => state === "success") ? "passed" : "pending";
}

export type RefundReason = "build_failed" | "not_delivered";

/**
 * No fix, no pay, judged on DeployDoctor's own fix commit: refund a paid, opened order when Vercel failed that
 * commit. A commit the buyer pushed on top, a promo order, or an order already passed or refunded is not refunded.
 */
export function refundForBuild(order: { status: string; promo: boolean; amount_minor: number; head_sha?: string | null; payment_intent_id?: string | null }, sha: string, outcome: BuildOutcome): boolean {
  return outcome === "failed" && order.status === "opened" && !order.promo && order.amount_minor > 0
    && Boolean(order.payment_intent_id) && Boolean(order.head_sha) && order.head_sha === sha;
}

/** A pull request that could not be opened for a reason a retry will not change. */
export function deliveryImpossible(status: number): boolean {
  return [403, 404, 409, 422].includes(status);
}
