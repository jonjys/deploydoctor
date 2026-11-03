import { fixAppFromEnv, readStatusEvent, verifyGithubWebhook } from "@/lib/fix-pr/github-app";
import { refundForBuild, vercelOutcome } from "@/lib/fix-pr/outcome";
import { fixOrdersByHeadSha, markFixOrder } from "@/lib/fix-pr/store";
import { refundFix } from "@/lib/fix-pr/refund";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GitHub reports a commit status. Only Vercel's status on DeployDoctor's own fix commit counts: a failure refunds
 * the $5 once, a success can put an opted-in public app on the Rescue Wall. Anything else is ignored.
 */
export async function POST(request: Request) {
  const app = fixAppFromEnv();
  if (!app?.webhookSecret) return Response.json({ error: "Webhook not configured." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Payload too large." }, { status: 413 });
  if (!verifyGithubWebhook(raw, request.headers.get("x-hub-signature-256"), app.webhookSecret)) return Response.json({ error: "Invalid signature." }, { status: 401 });
  if (request.headers.get("x-github-event") !== "status") return Response.json({ ignored: true });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid payload." }, { status: 400 }); }
  const status = readStatusEvent(payload);
  if (!status) return Response.json({ ignored: true });
  const outcome = vercelOutcome([{ context: status.context, state: status.state }]);
  if (outcome === "pending") return Response.json({ ignored: true });
  for (const order of await fixOrdersByHeadSha(status.sha).catch(() => [])) {
    // The order's repository must be the one GitHub reports, so another repo's status on the same SHA does nothing.
    if (status.repository && order.repo_url.toLowerCase() !== `https://github.com/${status.repository}`.toLowerCase()) continue;
    if (outcome === "passed") {
      await markFixOrder(order.stripe_session_id, { status: "passed" }).catch(() => undefined);
      continue;
    }
    if (refundForBuild(order, status.sha, outcome)) await refundFix(order.payment_intent_id!, order.stripe_session_id, "build_failed");
    else await markFixOrder(order.stripe_session_id, { status: "failed" }).catch(() => undefined);
  }
  return Response.json({ received: true });
}
