import "server-only";
import Stripe from "stripe";
import { plans, type Plan } from "@/lib/plans";
import { t, type Lang } from "@/lib/i18n";

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments are not enabled yet; free reports work as usual.");
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
}
export function priceFor(plan: Plan, lang: Lang = "en"): Stripe.Checkout.SessionCreateParams.LineItem {
  const item = plans[plan];
  if (item.env) {
    const price = process.env[item.env];
    if (!price?.startsWith("price_")) throw new Error("This price is not enabled yet.");
    return { price, quantity: 1 };
  }
  return { quantity: 1, price_data: { currency: "usd", unit_amount: item.amount,
    product_data: { name: `DeployDoctor — ${t(lang, `plan.${plan}.name` as "plan.fix-one.name")}`, description: t(lang, "pay.productDescription") } } };
}
export function scanPlanForPrice(price: string) {
  return (["week", "public", "private"] as const).find((plan) => process.env[plans[plan].env] === price);
}
export function objectId(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
