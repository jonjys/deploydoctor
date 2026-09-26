import { handleBillingEvent } from "@/lib/billing-events";
import { stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Webhook not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Payload too large." }, { status: 413 });
  let event;
  try { event = stripeClient().webhooks.constructEvent(raw, signature, secret); }
  catch { return Response.json({ error: "Invalid signature." }, { status: 400 }); }
  try {
    await handleBillingEvent(event);
    return Response.json({ received: true });
  } catch {
    console.error("Stripe fulfillment failed; retry required", event.id, event.type);
    return Response.json({ error: "Retry fulfillment." }, { status: 500 });
  }
}
