import "server-only";
import Stripe from "stripe";
import { plans, type Plan } from "@/lib/plans";

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Betalning är inte aktiverad ännu; gratisrapporter fungerar som vanligt.");
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
}
export function priceFor(plan: Plan): Stripe.Checkout.SessionCreateParams.LineItem {
  const item = plans[plan];
  if (item.env) {
    const price = process.env[item.env];
    if (!price?.startsWith("price_")) throw new Error("Det här priset är inte aktiverat ännu.");
    return { price, quantity: 1 };
  }
  return { quantity: 1, price_data: { currency: "usd", unit_amount: item.amount,
    product_data: { name: `DeployDoctor — ${item.name}`, description: "Manuell granskning och kodpatch för den valda rapporten; leverans efter granskning." } } };
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
