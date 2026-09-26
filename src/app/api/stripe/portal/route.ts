import { customerSession } from "@/lib/access";
import { sameOrigin, stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const customer = await customerSession();
  if (!customer) return Response.json({ error: "Öppna kontot i webbläsaren där du betalade." }, { status: 401 });
  try {
    const session = await stripeClient().billingPortal.sessions.create({ customer: customer.customerId,
      return_url: `${new URL(request.url).origin}/account` });
    return Response.json({ url: session.url });
  } catch { return Response.json({ error: "Kundportalen är inte tillgänglig just nu." }, { status: 503 }); }
}
