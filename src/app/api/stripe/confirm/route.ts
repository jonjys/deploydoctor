import { cookies } from "next/headers";
import { cookieOptions, SESSION_COOKIE, activePlan } from "@/lib/access";
import { digest, signSession } from "@/lib/session-token";
import { objectId, sameOrigin, stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const { sessionId } = await request.json();
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return Response.json({ error: "Invalid session." }, { status: 400 });
    const cookieStore = await cookies();
    const nonce = cookieStore.get("dd_checkout")?.value;
    if (!nonce) return Response.json({ error: "Öppna bekräftelsen i webbläsaren där du betalade." }, { status: 403 });
    const checkout = await stripeClient().checkout.sessions.retrieve(sessionId);
    if (checkout.metadata?.app !== "deploydoctor" || checkout.metadata.browser !== digest(`checkout:${nonce}`)) {
      return Response.json({ error: "Den här betalningen tillhör en annan webbläsare." }, { status: 403 });
    }
    if (checkout.status !== "complete" || checkout.payment_status !== "paid") return Response.json({ pending: true });
    const customerId = objectId(checkout.customer);
    const email = checkout.customer_details?.email?.toLowerCase();
    if (!customerId || !email) return Response.json({ error: "Kunduppgifter saknas." }, { status: 409 });
    const session = { customerId, email, expiresAt: Date.now() + 90 * 86400_000 };
    // This identifies the browser only; access is ALWAYS read from webhook-written rows.
    cookieStore.set(SESSION_COOKIE, signSession(session), { ...cookieOptions, maxAge: 90 * 86400 });
    const repair = checkout.metadata.plan?.startsWith("fix-");
    const plan = repair ? null : await activePlan(session);
    return Response.json({ pending: !repair && !plan, href: "/account", repair });
  } catch {
    return Response.json({ error: "Betalningen kunde inte bekräftas ännu; försök igen." }, { status: 503 });
  }
}
