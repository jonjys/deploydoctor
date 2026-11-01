export const WEBHOOK_EXAMPLE = `import Stripe from "stripe";
import { db } from "@/lib/db";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
export async function POST(req: Request) {
  const payload = await req.json();
  const event = stripe.webhooks.constructEvent(
    JSON.stringify(payload), req.headers.get("stripe-signature")!,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
  const session = event.data.object as Stripe.Checkout.Session;
  if (event.type === "checkout.session.completed") {
    await db.credits.create({ data: { sessionId: session.id, amount: 100 } });
  }
  return Response.json({ received: true });
}`;
