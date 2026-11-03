import { stripeClient } from "@/lib/stripe";
import { FIX_APP } from "@/lib/fix-pr/constants";
import { fixAppFromEnv, readCheckEvent, verifyGithubWebhook } from "@/lib/fix-pr/github-app";
import { buildOutcome } from "@/lib/fix-pr/outcome";
import { fixOrderByPullRequest, markFixOrder } from "@/lib/fix-pr/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GitHub tells us the pull request build finished. A failure refunds the $5. A pass can join the Rescue Wall. */
export async function POST(request: Request) {
  const app = fixAppFromEnv();
  if (!app?.webhookSecret) return Response.json({ error: "Webhook not configured." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Payload too large." }, { status: 413 });
  if (!verifyGithubWebhook(raw, request.headers.get("x-hub-signature-256"), app.webhookSecret)) return Response.json({ error: "Invalid signature." }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid payload." }, { status: 400 }); }
  const check = readCheckEvent(payload);
  if (!check) return Response.json({ ignored: true });
  const outcome = buildOutcome([{ conclusion: check.conclusion, status: "completed" }]);
  for (const prUrl of check.prUrls) {
    const order = await fixOrderByPullRequest(prUrl).catch(() => null);
    if (!order?.stripe_session_id) continue;
    if (outcome === "passed") {
      await markFixOrder(order.stripe_session_id, { status: "passed", head_sha: check.headSha }).catch(() => undefined);
      continue;
    }
    if (outcome !== "failed" || order.promo || !order.payment_intent_id || order.status === "refunded" || order.amount_minor <= 0) continue;
    const refund = await stripeClient().refunds.create({
      payment_intent: order.payment_intent_id, reason: "requested_by_customer", metadata: { app: FIX_APP, reason: "build_failed" },
    }, { idempotencyKey: `fix-refund-${order.payment_intent_id}` });
    await markFixOrder(order.stripe_session_id, { status: "refunded", refund_id: refund.id }).catch(() => undefined);
  }
  return Response.json({ received: true });
}
