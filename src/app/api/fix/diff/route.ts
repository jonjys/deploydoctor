import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { PatchError } from "@/lib/patch/case-patch";
import { signingSecret } from "@/lib/session-token";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { readGatedFixPatch } from "@/lib/fix-pr/open";

import { fixOrderBySession } from "@/lib/fix-pr/store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const SESSION = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;

/** The unified diff. Refused until the Checkout Session is paid or a launch receipt matches the quote. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({
      sessionId: z.string().regex(SESSION).optional(),
      quoteToken: z.string().min(40).max(20_000).optional(),
      receipt: z.string().min(20).max(2_500).optional(),
    }).safeParse(JSON.parse(await boundedBody(request, 28_000)));
    if (!parsed.success) return Response.json({ error: "Unknown order." }, { status: 400, headers: noStore });
    const secret = signingSecret();
    const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
    if (parsed.data.receipt && parsed.data.quoteToken) {
      const patch = readGatedFixPatch({ session: null, promoReceipt: parsed.data.receipt, quoteToken: parsed.data.quoteToken, secret });
      return Response.json({ filename: "deploydoctor-fix.patch", patch: patch.patch }, { headers: noStore });
    }
    if (!parsed.data.sessionId) return Response.json({ error: "Pay for this fix before the diff is released." }, { status: 402, headers: noStore });
    const session = await stripeClient().checkout.sessions.retrieve(parsed.data.sessionId, { expand: ["payment_intent.latest_charge"] });
    if (session.id !== parsed.data.sessionId) return Response.json({ error: "Payment session mismatch." }, { status: 403, headers: noStore });
    // The paid diff comes with the pull request: never before it is opened, so a refund for "not delivered" can
    // never leave the buyer holding the patch.
    const order = await fixOrderBySession(session.id).catch(() => null);
    if (!order?.pr_url || order.status === "refunded") return Response.json({ error: "The patch is released together with the pull request. Open the pull request first." }, { status: 409, headers: noStore });
    const patch = readGatedFixPatch({ session, promoReceipt: null, quoteToken: parsed.data.quoteToken ?? "", secret, live });
    return Response.json({ filename: "deploydoctor-fix.patch", patch: patch.patch }, { headers: noStore });
  } catch (error) {
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    return Response.json({ error: "The diff could not be released." }, { status: 503, headers: noStore });
  }
}
