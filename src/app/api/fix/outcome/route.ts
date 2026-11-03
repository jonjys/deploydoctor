import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { PatchError } from "@/lib/patch/case-patch";
import { tokenHash } from "@/lib/patch/quote";
import { signingSecret } from "@/lib/session-token";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { FIX_APP } from "@/lib/fix-pr/constants";
import { githubApi, resolveFixToken } from "@/lib/fix-pr/fulfill";
import { buildOutcome, refundReason } from "@/lib/fix-pr/outcome";
import { chargeRefunded, validateFixPayment } from "@/lib/fix-pr/payments";
import { markFixOrder } from "@/lib/fix-pr/store";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };
const SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

type Pull = { html_url?: string; head?: { sha?: string } };

/** Confirms the pull request build with GitHub, then refunds a paid fix that did not pass. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({ sessionId: z.string().regex(SESSION), action: z.enum(["build", "missing"]) }).safeParse(JSON.parse(await boundedBody(request, 800)));
    if (!parsed.success) return Response.json({ error: "Unknown order." }, { status: 400, headers: noStore });
    const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
    const session = await stripeClient().checkout.sessions.retrieve(parsed.data.sessionId, { expand: ["payment_intent.latest_charge"] });
    if (session.id !== parsed.data.sessionId) return Response.json({ error: "Payment session mismatch." }, { status: 403, headers: noStore });
    if (chargeRefunded(session)) return Response.json({ refunded: true, outcome: "refunded" }, { headers: noStore });
    const quote = validateFixPayment(session, signingSecret(), live);
    const token = await resolveFixToken();
    if (!token) return Response.json({ error: "Connect GitHub to check the build.", needsGitHub: true }, { status: 409, headers: noStore });
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(quote.repoUrl);
    if (!match) return Response.json({ error: "The order repository is not valid." }, { status: 422, headers: noStore });
    const api = githubApi(token);
    const branch = `deploydoctor/fix-${tokenHash(session.id).slice(0, 24)}`;
    const pulls = await api<Pull[]>(`/repos/${match[1]}/${match[2]}/pulls?state=all&head=${encodeURIComponent(`${match[1]}:${branch}`)}&per_page=1`);
    const pull = pulls[0];
    const prUrl = typeof pull?.html_url === "string" ? pull.html_url : null;
    if (!prUrl || !pull?.head?.sha) {
      if (parsed.data.action !== "missing") return Response.json({ refunded: false, outcome: "pending", prUrl: null }, { headers: noStore });
      const refundId = await refundSession(session, "not_delivered");
      return Response.json({ refunded: true, outcome: "failed", reason: "not_delivered", refundId }, { headers: noStore });
    }
    const checks = await api<{ check_runs?: Array<{ status?: string; conclusion?: string | null }> }>(`/repos/${match[1]}/${match[2]}/commits/${pull.head.sha}/check-runs`);
    const outcome = buildOutcome(checks.check_runs ?? []);
    const reason = refundReason({ outcome, prUrl, deliveryFailed: false, alreadyRefunded: false });
    if (outcome === "passed") await markFixOrder(session.id, { status: "passed", pr_url: prUrl, head_sha: pull.head.sha }).catch(() => undefined);
    if (parsed.data.action === "build" && reason === "build_failed") {
      const refundId = await refundSession(session, "build_failed");
      return Response.json({ refunded: true, outcome, prUrl, reason, refundId }, { headers: noStore });
    }
    return Response.json({ refunded: false, outcome, prUrl }, { headers: noStore });
  } catch (error) {
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    console.error("Fix outcome check failed");
    return Response.json({ error: "The build could not be checked right now." }, { status: 503, headers: noStore });
  }
}

async function refundSession(session: { id: string; payment_intent?: unknown }, reason: string) {
  const intent = session.payment_intent as { id?: string } | string | null | undefined;
  const id = typeof intent === "string" ? intent : intent?.id;
  if (!id) throw new PatchError("The payment cannot be refunded yet.", 409, "payment");
  const refund = await stripeClient().refunds.create({
    payment_intent: id, reason: "requested_by_customer", metadata: { app: FIX_APP, reason },
  }, { idempotencyKey: `fix-refund-${id}` });
  await markFixOrder(session.id, { status: "refunded", refund_id: refund.id }).catch(() => undefined);
  return refund.id;
}
