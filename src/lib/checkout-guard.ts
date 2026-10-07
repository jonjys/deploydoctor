import type Stripe from "stripe";
import type { Lang } from "@/lib/i18n";
import { plans, type Plan } from "@/lib/plans";

const PRICE_PLANS = ["week", "public", "private"] as const;

/** Health checks opt out with this header. Context is never used; repo names like healthcare-app must still check out. */
export function isProbeHeader(headers: Headers): boolean {
  return headers.get("x-health-probe")?.trim() === "1";
}

export function checkoutContext(context: unknown): string {
  return typeof context === "string" ? context.slice(0, 300) : "";
}

/** Prefer a Stripe-hosted answer from older sessions, then the metadata we store now. */
export function orderContext(session: {
  custom_fields?: Array<{ key?: string | null; text?: { value?: string | null } | null }> | null;
  metadata?: { context?: string | null } | null;
}): string | null | undefined {
  const field = session.custom_fields?.find((item) => item.key === "context")?.text?.value;
  if (typeof field === "string" && field.length > 0) return field;
  return session.metadata?.context;
}

export function configuredScanPriceId(env: Record<string, string | undefined> = process.env): string | null {
  for (const plan of PRICE_PLANS) {
    const price = env[plans[plan].env];
    if (price?.startsWith("price_")) return price;
  }
  return null;
}

export type StripeHealthBody = { ok: boolean; stripe: "reachable" | "unconfigured" | "unreachable" };

export async function readStripeHealth(input: {
  secretConfigured: boolean;
  priceId: string | null;
  retrieve: (priceId: string) => Promise<unknown>;
}): Promise<{ body: StripeHealthBody; status: number }> {
  if (!input.secretConfigured || !input.priceId) {
    return { body: { ok: false, stripe: "unconfigured" }, status: 503 };
  }
  try {
    const price = await input.retrieve(input.priceId);
    if (!price || typeof price !== "object") return { body: { ok: false, stripe: "unreachable" }, status: 503 };
    return { body: { ok: true, stripe: "reachable" }, status: 200 };
  } catch (error) {
    console.error("Stripe health check failed", error instanceof Error ? error.name : "Error");
    return { body: { ok: false, stripe: "unreachable" }, status: 503 };
  }
}

export function checkoutSessionParams(input: {
  plan: Plan;
  lang: Lang;
  reportId: string;
  checkId: string;
  context: string;
  browser: string;
  origin: string;
  customerId?: string;
  lineItem: Stripe.Checkout.SessionCreateParams.LineItem;
  integrationIdentifier: string;
}): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    app: "deploydoctor",
    plan: input.plan,
    reportId: input.reportId,
    checkId: input.checkId,
    context: input.context,
    browser: input.browser,
  };
  return {
    mode: plans[input.plan].mode,
    line_items: [input.lineItem],
    locale: input.lang,
    ...(input.customerId
      ? { customer: input.customerId }
      : plans[input.plan].mode === "payment"
        ? { customer_creation: "always" as const }
        : {}),
    metadata,
    ...(plans[input.plan].mode === "subscription"
      ? { subscription_data: { metadata: { app: "deploydoctor", plan: input.plan } } }
      : {}),
    success_url: `${input.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/checkout?plan=${input.plan}${input.reportId ? `&report=${input.reportId}&check=${input.checkId}` : ""}`,
    integration_identifier: input.integrationIdentifier,
  };
}
