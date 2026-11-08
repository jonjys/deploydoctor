import type Stripe from "stripe";
import type { Lang } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { openQuote, quoteMetadata, tokenFromMetadata, tokenHash, type PatchQuote } from "@/lib/patch/quote";
import { FIX_AMOUNT, FIX_APP, FIX_CURRENCY, fixIntegrationLabel } from "@/lib/fix-pr/constants";

export type FixCheckoutExtras = { installationId?: string; consent?: boolean; liveUrl?: string; errorSummary?: string };

/** One-time Checkout for the fix pull request. The diff stays inside the encrypted quote. */
export function fixCheckoutParams(token: string, secret: string, origin: string, lang: Lang, extras: FixCheckoutExtras = {}): Stripe.Checkout.SessionCreateParams {
  const quote = openQuote(token, secret);
  const sv = lang === "sv";
  const metadata: Record<string, string> = {
    ...quoteMetadata(token, quote.accessKey, quote.reportId),
    app: FIX_APP,
    consent: extras.consent ? "1" : "0",
  };
  if (extras.installationId && /^\d{1,12}$/.test(extras.installationId)) metadata.installation_id = extras.installationId;
  if (extras.liveUrl && extras.liveUrl.length <= 300) metadata.live_url = extras.liveUrl;
  if (extras.errorSummary) metadata.error_summary = extras.errorSummary.slice(0, 180);
  return {
    mode: "payment",
    adaptive_pricing: { enabled: false },
    locale: lang,
    expires_at: quote.expiresAt,
    line_items: [{ quantity: 1, price_data: { currency: FIX_CURRENCY, unit_amount: FIX_AMOUNT, product_data: {
      name: sv ? "DeployDoctor: fix som pull request" : "DeployDoctor: fix pull request",
      description: sv
        ? "En pull request med den verifierade fixen. Återbetalas om Vercels bygge av fixen fallerar."
        : "A pull request with the verified fix. Refunded if Vercel's build of the fix fails.",
    } } }],
    metadata,
    payment_intent_data: { metadata: { app: FIX_APP, quote_hash: tokenHash(token), report_id: quote.reportId } },
    success_url: `${origin}/fix/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/fix`,
    integration_identifier: fixIntegrationLabel(quote.nonce),
  };
}

/** Releases the quote only for a complete $5 payment that is not refunded or disputed. */
export function validateFixPayment(session: Stripe.Checkout.Session, secret: string, live?: boolean): PatchQuote {
  const metadata = session.metadata ?? {};
  if (metadata.app !== FIX_APP || session.mode !== "payment" || session.currency !== FIX_CURRENCY || session.amount_total !== FIX_AMOUNT)
    throw new PatchError("This payment does not match a fix order.", 403, "payment");
  const quote = openQuote(tokenFromMetadata(metadata), secret, false);
  if (quote.reportId !== metadata.report_id) throw new PatchError("Order access data is invalid.", 403, "payment");
  if (live !== undefined && session.livemode !== live) throw new PatchError("Payment environment does not match.", 403, "payment");
  if (session.status !== "complete") throw new PatchError("The payment is not complete, so the pull request stays closed.", 402, "payment");
  if (session.payment_status !== "paid") throw new PatchError("The payment is still processing. Reload this page in a minute.", 402, "pending");
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string" || intent.status !== "succeeded") throw new PatchError("The payment is not confirmed yet. Reload this page in a minute.", 402, "pending");
  if (intent.amount_received !== FIX_AMOUNT || intent.currency !== FIX_CURRENCY) throw new PatchError("The received payment does not match the order.", 402, "payment");
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string" || !charge.paid || charge.status !== "succeeded" || charge.refunded || charge.amount_refunded > 0 || charge.disputed)
    throw new PatchError("The payment is unconfirmed, refunded or disputed.", 402, "payment");
  return quote;
}

export function chargeRefunded(session: Stripe.Checkout.Session): boolean {
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string") return false;
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return false;
  return charge.refunded || charge.amount_refunded > 0;
}
