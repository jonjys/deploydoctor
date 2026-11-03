import type Stripe from "stripe";
import { cronAuthorized, cronSecret } from "@/lib/watch";
import { stripeClient } from "@/lib/stripe";
import { signingSecret } from "@/lib/session-token";
import { FIX_AMOUNT, FIX_APP } from "@/lib/fix-pr/constants";
import { chargeRefunded, validateFixPayment } from "@/lib/fix-pr/payments";
import { fixOrderBySession, saveFixOrder } from "@/lib/fix-pr/store";
import { refundFix } from "@/lib/fix-pr/refund";

export const maxDuration = 120;
const GRACE_MS = 24 * 3600_000;
const WINDOW_S = 7 * 86_400;
const MAX_REFUNDS = 50;

/**
 * Daily, from Vercel Cron with Authorization: Bearer CRON_SECRET. No fix, no pay: a fix paid more than a day ago
 * that never got a pull request (the buyer closed the tab, GitHub was never connected) is refunded once.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret) return Response.json({ error: "Cron is not configured." }, { status: 503 });
  if (!cronAuthorized(request.headers.get("authorization"), secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ skipped: "stripe" });
  const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY);
  const now = Date.now();
  let checked = 0, refunded = 0;
  const sessions = stripeClient().checkout.sessions.list({ created: { gte: Math.floor(now / 1000) - WINDOW_S }, limit: 100, expand: ["data.payment_intent.latest_charge"] });
  for await (const session of sessions as AsyncIterable<Stripe.Checkout.Session>) {
    if (refunded >= MAX_REFUNDS || ++checked > 1000) break;
    if (session.metadata?.app !== FIX_APP || session.created * 1000 > now - GRACE_MS || chargeRefunded(session)) continue;
    let quote;
    try { quote = validateFixPayment(session, signingSecret(), live); } catch { continue; }
    const order = await fixOrderBySession(session.id).catch(() => undefined);
    if (order === undefined || order?.pr_url || order?.status === "refunded") continue;
    const intent = session.payment_intent as Stripe.PaymentIntent;
    if (!order) await saveFixOrder({ repo_url: quote.repoUrl, commit_sha: quote.commitSha, status: "paid", promo: false, amount_minor: FIX_AMOUNT,
      stripe_session_id: session.id, payment_intent_id: intent.id, consent: false }).catch(() => undefined);
    try { await refundFix(intent.id, session.id, "not_delivered"); refunded++; }
    catch { console.error("Fix reconcile refund failed"); }
  }
  return Response.json({ checked, refunded });
}
