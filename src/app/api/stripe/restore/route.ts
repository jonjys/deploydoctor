import { cookies } from "next/headers";
import { activePlan, cookieOptions, SESSION_COOKIE } from "@/lib/access";
import { signSession } from "@/lib/session-token";
import { objectId, sameOrigin, stripeClient } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

/**
 * Bring a purchase into a browser other than the one it was paid in.
 *
 * Normal checkout ties the pass to the paying browser (see /api/stripe/confirm).
 * Here the proof is two things only the buyer has together: the Checkout
 * Session ID (the cs_… reference on the payment in Stripe, or in the success
 * page address) and the email used at checkout. Both must match a completed,
 * paid DeployDoctor checkout. Wrong combinations get one generic answer.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 1000) return Response.json({ error: t(lang, "restore.notFound") }, { status: 400 });
    const { sessionId, email } = JSON.parse(raw) as { sessionId?: unknown; email?: unknown };
    if (typeof sessionId !== "string" || !/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId.trim()) ||
      typeof email !== "string" || email.length > 254) {
      return Response.json({ error: t(lang, "restore.notFound") }, { status: 400 });
    }
    let checkout;
    try { checkout = await stripeClient().checkout.sessions.retrieve(sessionId.trim()); }
    catch { return Response.json({ error: t(lang, "restore.notFound") }, { status: 404 }); }
    const paidEmail = checkout.customer_details?.email?.toLowerCase();
    const customerId = objectId(checkout.customer);
    if (checkout.metadata?.app !== "deploydoctor" || checkout.status !== "complete" || checkout.payment_status !== "paid" ||
      !paidEmail || !customerId || paidEmail !== email.trim().toLowerCase()) {
      return Response.json({ error: t(lang, "restore.notFound") }, { status: 404 });
    }
    const session = { customerId, email: paidEmail, expiresAt: Date.now() + 90 * 86400_000 };
    (await cookies()).set(SESSION_COOKIE, signSession(session), { ...cookieOptions, maxAge: 90 * 86400 });
    const plan = await activePlan(session);
    return Response.json({ href: "/account", active: Boolean(plan) });
  } catch {
    return Response.json({ error: t(lang, "restore.failed") }, { status: 503 });
  }
}
