import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { PatchError } from "@/lib/patch/case-patch";
import { signingSecret } from "@/lib/session-token";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { githubApi, resolveFixToken } from "@/lib/fix-pr/fulfill";
import { refundForBuild, vercelOutcome } from "@/lib/fix-pr/outcome";
import { chargeRefunded, validateFixPayment } from "@/lib/fix-pr/payments";
import { fixOrderBySession, markFixOrder } from "@/lib/fix-pr/store";
import { refundFix } from "@/lib/fix-pr/refund";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };
const SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/**
 * "Build failed? Refund me": checks Vercel's status on DeployDoctor's own fix commit and refunds a paid order once
 * when Vercel failed it. A pull request that could not be opened is refunded automatically when opening fails,
 * and by the daily reconcile job, so there is no self-service "not delivered" refund.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({ sessionId: z.string().regex(SESSION), action: z.literal("build") }).safeParse(JSON.parse(await boundedBody(request, 800)));
    if (!parsed.success) return Response.json({ error: "Unknown order." }, { status: 400, headers: noStore });
    const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
    const session = await stripeClient().checkout.sessions.retrieve(parsed.data.sessionId, { expand: ["payment_intent.latest_charge"] });
    if (session.id !== parsed.data.sessionId) return Response.json({ error: "Payment session mismatch." }, { status: 403, headers: noStore });
    if (chargeRefunded(session)) return Response.json({ refunded: true, outcome: "refunded" }, { headers: noStore });
    const quote = validateFixPayment(session, signingSecret(), live);
    const order = await fixOrderBySession(session.id);
    if (!order?.pr_url || !order.head_sha) return Response.json({ refunded: false, outcome: "pending", prUrl: null }, { headers: noStore });
    const token = await resolveFixToken();
    if (!token) return Response.json({ error: "Connect GitHub to check the build.", needsGitHub: true }, { status: 409, headers: noStore });
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(quote.repoUrl);
    if (!match) return Response.json({ error: "The order repository is not valid." }, { status: 422, headers: noStore });
    const combined = await githubApi(token)<{ statuses?: Array<{ context?: string; state?: string }> }>(`/repos/${match[1]}/${match[2]}/commits/${order.head_sha}/status`);
    const outcome = vercelOutcome(combined.statuses ?? []);
    if (outcome === "passed") await markFixOrder(session.id, { status: "passed" }).catch(() => undefined);
    if (refundForBuild(order, order.head_sha, outcome)) {
      const refundId = await refundFix(order.payment_intent_id!, session.id, "build_failed");
      return Response.json({ refunded: true, outcome, prUrl: order.pr_url, reason: "build_failed", refundId }, { headers: noStore });
    }
    return Response.json({ refunded: false, outcome, prUrl: order.pr_url }, { headers: noStore });
  } catch (error) {
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    console.error("Fix outcome check failed");
    return Response.json({ error: "The build could not be checked right now." }, { status: 503, headers: noStore });
  }
}
