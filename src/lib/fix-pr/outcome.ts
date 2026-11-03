export type BuildOutcome = "passed" | "failed" | "pending";

const FAILED = new Set(["failure", "failed", "cancelled", "timed_out", "startup_failure", "action_required"]);
const PASSED = new Set(["success", "neutral", "skipped"]);

/** Pending checks are not a failed build. A refund waits until GitHub has finished them. */
export function buildOutcome(checks: Array<{ status?: string | null; conclusion?: string | null }>): BuildOutcome {
  if (!checks.length) return "pending";
  const states = checks.map((check) => (check.conclusion || check.status || "").toLowerCase());
  if (states.some((state) => state === "" || state === "queued" || state === "pending" || state === "in_progress" || state === "waiting" || state === "requested")) return "pending";
  if (states.some((state) => FAILED.has(state))) return "failed";
  if (states.every((state) => PASSED.has(state))) return "passed";
  return "pending";
}

export type RefundReason = "build_failed" | "not_delivered";

/**
 * No fix, no pay. Refund when the pull request's build failed, or when payment succeeded and no pull request
 * could be opened. A check that is still running is not a reason to refund.
 */
export function refundReason(input: { outcome: BuildOutcome; prUrl: string | null; deliveryFailed: boolean; alreadyRefunded: boolean }): RefundReason | null {
  if (input.alreadyRefunded) return null;
  if (input.deliveryFailed && !input.prUrl) return "not_delivered";
  if (input.prUrl && input.outcome === "failed") return "build_failed";
  return null;
}
