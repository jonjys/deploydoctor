import { customerSession } from "@/lib/access";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";
import { appOrigin } from "@/lib/site";

export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  const customer = await customerSession();
  if (!customer) return Response.json({ error: t(lang, "pay.portalOpen") }, { status: 401 });
  try {
    const session = await stripeClient().billingPortal.sessions.create({ customer: customer.customerId,
      return_url: `${appOrigin(request)}/account` });
    return Response.json({ url: session.url });
  } catch { return Response.json({ error: t(lang, "pay.portalUnavailable") }, { status: 503 }); }
}
