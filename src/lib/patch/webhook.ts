import type Stripe from "stripe";
import { PatchError } from "@/lib/patch/case-patch";
import { validatePatchPayment } from "@/lib/patch/payments";
import { PATCH_APP } from "@/lib/patch/quote";

/** Stateless fulfillment: the encrypted quote is durable in Stripe. Repeats never issue new grants.
 * Current Stripe state is checked again on every delivery, so late success events cannot undo refunds/disputes. */
export async function handlePatchEvent(event: Stripe.Event, secret: string, live: boolean,
  loadSession: (id: string) => Promise<Stripe.Checkout.Session>): Promise<boolean> {
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) {
    return true; // There is no cached delivery entitlement to revoke or resurrect.
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type)) return false;
  const payload = event.data.object as Stripe.Checkout.Session;
  if (payload.metadata?.app !== PATCH_APP) return false;
  if (event.type === "checkout.session.async_payment_failed") return true;
  const current = await loadSession(payload.id);
  if (current.id !== payload.id) throw new Error("Patch payment session mismatch");
  try { validatePatchPayment(current, secret, undefined, live); }
  catch (error) {
    if (!(error instanceof PatchError) || error.status >= 500) throw error;
    // Pending, refunded and disputed orders receive no access. A later download must pass validation anew.
  }
  return true;
}
