import { activePlan, customerSession } from "@/lib/access";

// What this browser is entitled to right now. The cookie only says who the
// customer is; the pass itself is always read from the webhook-written rows.
export async function GET() {
  const session = await customerSession();
  const plan = await activePlan(session);
  return Response.json(
    { signedIn: Boolean(session), active: Boolean(plan), plan: plan?.plan ?? null, until: plan?.current_period_end ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
