import "server-only";
import { stripeClient } from "@/lib/stripe";
import { FIX_APP } from "@/lib/fix-pr/constants";
import { markFixOrder } from "@/lib/fix-pr/store";
import type { RefundReason } from "@/lib/fix-pr/outcome";

/** Refunds a paid fix once (Stripe idempotency key per payment) and records it. Returns the refund id. */
export async function refundFix(paymentIntentId: string, sessionId: string, reason: RefundReason): Promise<string> {
  const refund = await stripeClient().refunds.create({
    payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { app: FIX_APP, reason },
  }, { idempotencyKey: `fix-refund-${paymentIntentId}` });
  await markFixOrder(sessionId, { status: "refunded", refund_id: refund.id }).catch(() => console.error("Fix refund was not recorded"));
  return refund.id;
}
