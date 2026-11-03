import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { PatchError } from "@/lib/patch/case-patch";
import { openQuote } from "@/lib/patch/quote";
import { PullRequestApiError } from "@/lib/patch/pull-request";
import { signingSecret } from "@/lib/session-token";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { FIX_AMOUNT } from "@/lib/fix-pr/constants";
import { fulfillPaidFix, githubApi, promoOrderId, resolveFixToken } from "@/lib/fix-pr/fulfill";
import { openGatedFixPullRequest } from "@/lib/fix-pr/open";
import { saveFixOrder } from "@/lib/fix-pr/store";
import { cleanLiveUrl } from "@/lib/fix-pr/wall";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };
const SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/** Opens the pull request after Stripe confirms payment, or after a signed free-slot receipt. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({
      sessionId: z.string().regex(SESSION).optional(),
      quoteToken: z.string().min(40).max(20_000).optional(),
      receipt: z.string().min(20).max(2_500).optional(),
      consent: z.boolean().optional(),
      liveUrl: z.string().max(300).optional(),
      errorSummary: z.string().max(240).optional(),
    }).safeParse(JSON.parse(await boundedBody(request, 28_000)));
    if (!parsed.success) return Response.json({ error: "Send the checkout session or the free-fix receipt." }, { status: 400, headers: noStore });
    const token = await resolveFixToken();
    if (!token) return Response.json({ error: "Connect GitHub before the pull request can be opened.", needsGitHub: true }, { status: 409, headers: noStore });
    if (parsed.data.receipt) {
      if (!parsed.data.quoteToken) return Response.json({ error: "The free fix does not match the diagnosis." }, { status: 403, headers: noStore });
      const secret = signingSecret();
      const summary = (parsed.data.errorSummary || "Verified deploy fix").slice(0, 180);
      const result = await openGatedFixPullRequest({
        session: null, promoReceipt: parsed.data.receipt, quoteToken: parsed.data.quoteToken, secret, summary, api: githubApi(token),
      });
      const quote = openQuote(parsed.data.quoteToken, secret, false);
      const liveUrl = parsed.data.liveUrl ? cleanLiveUrl(parsed.data.liveUrl) : null;
      await saveFixOrder({
        repo_url: quote.repoUrl, commit_sha: quote.commitSha, status: "opened", promo: true, amount_minor: 0,
        stripe_session_id: promoOrderId(parsed.data.quoteToken), pr_url: result.url, error_summary: summary,
        live_url: liveUrl, consent: Boolean(parsed.data.consent && liveUrl),
      }).catch(() => console.error("Fix order was not saved"));
      return Response.json({ url: result.url, reused: result.reused, paid: false }, { headers: noStore });
    }
    if (!parsed.data.sessionId) return Response.json({ error: "Send the checkout session or the free-fix receipt." }, { status: 400, headers: noStore });
    const session = await stripeClient().checkout.sessions.retrieve(parsed.data.sessionId, { expand: ["payment_intent.latest_charge"] });
    if (session.id !== parsed.data.sessionId) return Response.json({ error: "Payment session mismatch." }, { status: 403, headers: noStore });
    const result = await fulfillPaidFix(session, token);
    if (!result) return Response.json({ error: "Connect GitHub before the pull request can be opened.", needsGitHub: true }, { status: 409, headers: noStore });
    return Response.json({ url: result.url, reused: result.reused, paid: true, amountMinor: FIX_AMOUNT }, { headers: noStore });
  } catch (error) {
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    if (error instanceof PullRequestApiError) return Response.json({ error: error.message }, { status: error.status === 401 || error.status === 403 ? 403 : 503, headers: noStore });
    console.error("Fix pull request failed");
    return Response.json({ error: "The pull request could not be opened. Retry with the same order. Do not buy it again." }, { status: 503, headers: noStore });
  }
}
