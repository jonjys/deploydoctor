import { connection } from "next/server";
import { configuredScanPriceId, readStripeHealth } from "@/lib/checkout-guard";
import { stripeClient } from "@/lib/stripe";

// Read-only: retrieves one configured Price. Never creates a Checkout Session or returns secrets.
export async function GET() {
  await connection();
  const result = await readStripeHealth({
    secretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    priceId: configuredScanPriceId(),
    retrieve: (priceId) => stripeClient().prices.retrieve(priceId),
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
