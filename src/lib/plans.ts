export const plans = {
  day: { name: "24-hour pass", price: "19 kr", cadence: "one-time \u00b7 24 hours \u00b7 $2", mode: "payment", amount: 200, env: "" },
  week: { name: "7-day pass", price: "49 kr", cadence: "one-time \u00b7 7 days \u00b7 $5", mode: "payment", amount: 500, env: "STRIPE_PRICE_5_ONETIME" },
  public: { name: "Public", price: "89 kr", cadence: "/ month \u00b7 $9", mode: "subscription", amount: 900, env: "STRIPE_PRICE_9_PUBLIC" },
  private: { name: "Private", price: "179 kr", cadence: "/ month \u00b7 $19", mode: "subscription", amount: 1900, env: "STRIPE_PRICE_19_PRIVATE" },
  "fix-one": { name: "Fix this one", price: "49 kr", cadence: "one-time \u00b7 one failed check \u00b7 $5", mode: "payment", amount: 500, env: "" },
  "fix-all": { name: "Fix all", price: "229 kr", cadence: "one-time \u00b7 all failed checks \u00b7 $25", mode: "payment", amount: 2500, env: "" },
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
