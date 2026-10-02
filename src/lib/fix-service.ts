import type { Plan } from "@/lib/plans";

/**
 * The paid fix service (fix-one $5, fix-all $25) is paused. Flip this to true to show the buttons on
 * reports and pricing again and to let checkout create fix sessions. Existing repair_orders, the webhook
 * and /api/repairs keep working either way.
 */
export const FIX_SERVICE_ENABLED = false;

export function isFixPlan(plan: Plan): plan is "fix-one" | "fix-all" {
  return plan === "fix-one" || plan === "fix-all";
}
