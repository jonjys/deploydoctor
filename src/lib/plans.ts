export const plans = {
  day: { name: "24-hour pass", price: "$2", cadence: "one-time · 24 hours", mode: "payment", amount: 200, env: "" },
  week: { name: "7-day pass", price: "$5", cadence: "one-time · 7 days", mode: "payment", amount: 500, env: "STRIPE_PRICE_5_ONETIME" },
  public: { name: "Public", price: "$9", cadence: "/ month", mode: "subscription", amount: 900, env: "STRIPE_PRICE_9_PUBLIC" },
  private: { name: "Private", price: "$19", cadence: "/ month", mode: "subscription", amount: 1900, env: "STRIPE_PRICE_19_PRIVATE" },
  "fix-one": { name: "Fix this one", price: "$5", cadence: "one-time · one failed check", mode: "payment", amount: 500, env: "" },
  "fix-all": { name: "Fix all", price: "$25", cadence: "one-time · all failed checks in one report", mode: "payment", amount: 2500, env: "" },
} as const;
export type Plan = keyof typeof plans;
export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && Object.hasOwn(plans, value);
}
/** Every paid pass or subscription may scan private repositories with a read-only token. */
export function allowsPrivate(plan: Plan | null | undefined): boolean {
  return plan === "day" || plan === "week" || plan === "public" || plan === "private";
}
/** Only the subscriptions keep a personal scan history. */
export function hasHistory(plan: Plan | null | undefined): boolean {
  return plan === "public" || plan === "private";
}
export function isScanPlan(plan: Plan): plan is "day" | "week" | "public" | "private" {
  return plan === "day" || plan === "week" || plan === "public" || plan === "private";
}
