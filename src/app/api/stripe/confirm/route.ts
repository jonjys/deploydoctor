import { cookies } from "next/headers";
import { cookieOptions, SESSION_COOKIE, activePlan } from "@/lib/access";
import { handleBillingEvent } from "@/lib/billing-events";
import { confirmFallbackEvent, scanRepoFromContext } from "@/lib/checkout-guard";
import { digest, signSession } from "@/lib/session-token";
import { objectId, sameOrigin, stripeClient } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const { sessionId } = await request.json();
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return Response.json({ error: t(lang, "pay.invalidSession") }, { status: 400 });
    const cookieStore = await cookies();
    const nonce = cookieStore.get("dd_checkout")?.value;
    if (!nonce) return Response.json({ error: t(lang, "pay.confirmBrowser") }, { status: 403 });
    const checkout = await stripeClient().checkout.sessions.retrieve(sessionId);
    if (checkout.metadata?.app !== "deploydoctor" || checkout.metadata.browser !== digest(`checkout:${nonce}`)) {
      return Response.json({ error: t(lang, "pay.confirmOther") }, { status: 403 });
    }
    if (checkout.status !== "complete" || checkout.payment_status !== "paid") return Response.json({ pending: true });
    const customerId = objectId(checkout.customer);
    const email = checkout.customer_details?.email?.toLowerCase();
    if (!customerId || !email) return Response.json({ error: t(lang, "pay.confirmMissing") }, { status: 409 });
    const session = { customerId, email, expiresAt: Date.now() + 90 * 86400_000 };
    // This identifies the browser only; access is ALWAYS read from rows that handleBillingEvent writes.
    cookieStore.set(SESSION_COOKIE, signSession(session), { ...cookieOptions, maxAge: 90 * 86400 });
    const repair = checkout.metadata.plan?.startsWith("fix-");
    let plan = repair ? null : await activePlan(session);
    let via = repair ? "repair" : "webhook";
    if (!repair && !plan) {
      // Paid, but the webhook has not arrived yet: run the handler it would. handleBillingEvent fetches the session from
      // Stripe again, and apply_billing_event upserts on the session or subscription id, so the real event updates the same row.
      try {
        await handleBillingEvent(confirmFallbackEvent(checkout));
        plan = await activePlan(session);
        via = "confirm";
      } catch {
        console.error("Confirm fallback failed; waiting for the webhook", checkout.id);
      }
    }
    const pending = !repair && !plan;
    if (!pending) console.log("dd-funnel", JSON.stringify({ step: "paid", plan: checkout.metadata.plan ?? null, reason: via }));
    const repo = scanRepoFromContext(checkout.metadata.context);
    return Response.json({ pending, href: "/account", repair, ...(repo ? { repo } : {}) });
  } catch {
    return Response.json({ error: t(lang, "pay.confirmFailed") }, { status: 503 });
  }
}
