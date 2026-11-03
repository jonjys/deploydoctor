import type Stripe from "stripe";
import { PatchError } from "@/lib/patch/case-patch";
import { FIX_APP } from "@/lib/fix-pr/constants";
import { validateFixPayment } from "@/lib/fix-pr/payments";

type LoadSession = (id: string) => Promise<Stripe.Checkout.Session>;

/**
 * Accepts a fix Checkout event only when Stripe shows a paid, unrefunded session.
 * The pull request is opened later by /api/fix/pull-request, which loads the session again.
 * Returns false when the event belongs to another product.
 */
export async function handleFixEvent(event: Stripe.Event, secret: string, live: boolean, loadSession: LoadSession): Promise<boolean> {
  if (event.type === "charge.refunded") return (event.data.object as Stripe.Charge).metadata?.app === FIX_APP;
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded" && event.type !== "checkout.session.async_payment_failed") return false;
  const payload = event.data.object as Stripe.Checkout.Session;
  if (payload.metadata?.app !== FIX_APP) return false;
  if (event.type === "checkout.session.async_payment_failed") return true;
  const current = await loadSession(payload.id);
  if (current.id !== payload.id) throw new Error("Fix payment session mismatch");
  try { validateFixPayment(current, secret, live); }
  catch (error) {
    if (!(error instanceof PatchError) || error.status >= 500) throw error;
    return true;
  }
  return true;
}
