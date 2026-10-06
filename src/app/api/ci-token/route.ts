import { activePlan, customerSession } from "@/lib/access";
import { signApiToken } from "@/lib/session-token";
import { sameOrigin } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

/**
 * Issues an API token for CI to the browser that paid. The token is derived from the customer, not stored:
 * it works for as long as a pass is active and stops the moment the pass ends. Generating a new one does
 * not invalidate earlier ones; a pass that ends does.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  const customer = await customerSession();
  if (!customer) return Response.json({ error: t(lang, "account.needBrowser") }, { status: 401 });
  const plan = await activePlan(customer);
  if (!plan) return Response.json({ error: t(lang, "err.tokenPlan"), paywall: true }, { status: 402 });
  return Response.json({ token: signApiToken({ email: customer.email, customerId: customer.customerId }), plan: plan.plan, until: plan.current_period_end },
    { headers: { "Cache-Control": "no-store" } });
}
