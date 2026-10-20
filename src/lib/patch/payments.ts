import type Stripe from "stripe";
import type { Lang } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { openQuote, PATCH_APP, quoteMetadata, tokenFromMetadata, tokenHash, type PatchQuote } from "@/lib/patch/quote";

/** One flat price per verified patch, however many imports it fixes. Same $5 as a 7-day pass. */
export const PATCH_AMOUNT = 500;
export const PATCH_CURRENCY = "usd";
/** What the buyer saves and runs `git apply` on. */
export const PATCH_FILENAME = "deploydoctor-fix.patch";

/** Ported from ImportFix (src/lib/import-fix-payments.ts): one-time payment, the quote travels in metadata. */
export function patchCheckoutParams(token: string, secret: string, origin: string, lang: Lang): Stripe.Checkout.SessionCreateParams {
  const quote = openQuote(token, secret);
  const sv = lang === "sv";
  return {
    mode: "payment",
    // Adaptive pricing would charge in the buyer's currency; the payment check needs exactly $5.
    adaptive_pricing: { enabled: false },
    locale: lang,
    expires_at: quote.expiresAt,
    line_items: [{ quantity: 1, price_data: { currency: PATCH_CURRENCY, unit_amount: PATCH_AMOUNT, product_data: {
      name: sv ? "DeployDoctor: verifierad importpatch" : "DeployDoctor: verified import patch",
      description: sv
        ? `En färdig git-patch som rättar ${quote.fixes} import${quote.fixes === 1 ? "" : "er"} med fel versaler. Du granskar och applicerar den själv.`
        : `A ready git patch that fixes ${quote.fixes} import${quote.fixes === 1 ? "" : "s"} with the wrong letter case. You review and apply it yourself.`,
    } } }],
    metadata: quoteMetadata(token, quote.accessKey, quote.reportId),
    payment_intent_data: { metadata: { app: PATCH_APP, quote_hash: tokenHash(token), report_id: quote.reportId } },
    success_url: `${origin}/patch/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/r/${quote.reportId}#check-imports`,
    integration_identifier: `${PATCH_APP}_checkout_${quote.nonce.slice(0, 8).replace(/[0-9]/g, "a")}`,
  };
}

/**
 * The patch is only released for a complete, paid, matching session whose charge is not refunded or
 * disputed, and only to the browser holding the quote's private access key.
 */
export function validatePatchPayment(session: Stripe.Checkout.Session, secret: string, accessKey?: string, live?: boolean): PatchQuote {
  const metadata = session.metadata ?? {};
  if (metadata.app !== PATCH_APP || session.mode !== "payment" || session.currency !== PATCH_CURRENCY || session.amount_total !== PATCH_AMOUNT)
    throw new PatchError("This payment does not match a patch order.", 403, "payment");
  if (accessKey !== undefined && (!/^[a-f0-9]{64}$/.test(accessKey) || tokenHash(accessKey) !== metadata.access_hash))
    throw new PatchError("Open this page in the browser you paid from to download the patch.", 403, "access");
  const quote = openQuote(tokenFromMetadata(metadata), secret, false);
  if (quote.reportId !== metadata.report_id || tokenHash(quote.accessKey) !== metadata.access_hash) throw new PatchError("Order access data is invalid.", 403, "payment");
  if (live !== undefined && session.livemode !== live) throw new PatchError("Payment environment does not match.", 403, "payment");
  if (session.status !== "complete") throw new PatchError("The payment is not complete, so no patch is released.", 402, "payment");
  if (session.payment_status !== "paid") throw new PatchError("The payment is still processing. Reload this page in a minute.", 402, "pending");
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string" || intent.status !== "succeeded") throw new PatchError("The payment is not confirmed yet. Reload this page in a minute.", 402, "pending");
  if (intent.amount_received !== PATCH_AMOUNT || intent.currency !== PATCH_CURRENCY)
    throw new PatchError("The received payment does not match the order.", 402, "payment");
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string" || !charge.paid || charge.status !== "succeeded" || charge.refunded || charge.amount_refunded > 0 || charge.disputed)
    throw new PatchError("The payment is unconfirmed, refunded or disputed.", 402, "payment");
  return quote;
}

/** A session ID Stripe does not know is an unknown order, not an outage the buyer should wait out. */
export function stripeLookupFailure(error: unknown): PatchError {
  const failure = error as { statusCode?: number; code?: string } | null;
  return failure?.statusCode === 404 || failure?.code === "resource_missing"
    ? new PatchError("Unknown order.", 404, "payment")
    : new PatchError("The order could not be loaded from Stripe right now. Reload in a minute.", 503, "payment");
}

/** The browser keeps the access keys of its last few patch orders in one httpOnly cookie. */
export const PATCH_ACCESS_COOKIE = "dd_patch_access";
const KEPT_KEYS = 5;
export function readAccessKeys(cookie: string | undefined): string[] {
  return (cookie ?? "").split(".").filter((key) => /^[a-f0-9]{64}$/.test(key)).slice(0, KEPT_KEYS);
}
export function withAccessKey(cookie: string | undefined, key: string): string {
  return [key, ...readAccessKeys(cookie).filter((existing) => existing !== key)].slice(0, KEPT_KEYS).join(".");
}
