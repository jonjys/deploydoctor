import { cookies } from "next/headers";
import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { openGitHub } from "@/lib/github-connect-crypto";
import { langFromRequest } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { openQuote, tokenHash } from "@/lib/patch/quote";
import { signingSecret } from "@/lib/session-token";
import { appOrigin } from "@/lib/site";
import { sameOrigin, stripeClient } from "@/lib/stripe";
import { FIX_APP, FIX_PROMO_CAP } from "@/lib/fix-pr/constants";
import { fixCheckoutParams } from "@/lib/fix-pr/payments";
import { sealPromoReceipt } from "@/lib/fix-pr/promo";
import { FIX_INSTALL_COOKIE, fixInstallSchema } from "@/lib/fix-pr/session";
import { claimPromo } from "@/lib/fix-pr/store";
import { summarizeError } from "@/lib/fix-pr/offer";
import { cleanLiveUrl } from "@/lib/fix-pr/wall";

export const runtime = "nodejs";
export const maxDuration = 30;
const noStore = { "Cache-Control": "no-store" };

/** Claims a launch slot or starts Stripe Checkout. Neither response includes the patch. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: noStore });
  try {
    const parsed = z.object({
      quoteToken: z.string().min(40).max(20_000),
      consent: z.boolean().optional(),
      liveUrl: z.string().max(300).optional(),
      errorSummary: z.string().max(240).optional(),
      forcePayment: z.boolean().optional(),
    }).safeParse(JSON.parse(await boundedBody(request, 24_000)));
    if (!parsed.success) return Response.json({ error: "The fix offer is missing. Diagnose the repository again." }, { status: 400, headers: noStore });
    const secret = signingSecret();
    openQuote(parsed.data.quoteToken, secret);
    const liveUrl = parsed.data.liveUrl ? cleanLiveUrl(parsed.data.liveUrl) : null;
    if (parsed.data.liveUrl && !liveUrl) return Response.json({ error: "The live URL must be an https address for the app, not a GitHub URL." }, { status: 400, headers: noStore });
    const hash = tokenHash(parsed.data.quoteToken);
    if (!parsed.data.forcePayment) {
      const promo = await claimPromo(hash);
      if (promo.granted) {
        return Response.json({ promo: true, receipt: sealPromoReceipt(parsed.data.quoteToken, promo.claimed, secret), claimed: promo.claimed, cap: FIX_PROMO_CAP }, { headers: noStore });
      }
    }
    const jar = await cookies();
    const installation = openGitHub(jar.get(FIX_INSTALL_COOKIE)?.value, "fix-install", secret, fixInstallSchema);
    const installationId = installation && installation.expiresAt > Date.now() ? String(installation.installationId) : undefined;
    const origin = appOrigin(request);
    const session = await stripeClient().checkout.sessions.create(fixCheckoutParams(parsed.data.quoteToken, secret, origin, langFromRequest(request), {
      installationId, consent: Boolean(parsed.data.consent && liveUrl), liveUrl: liveUrl ?? undefined,
      errorSummary: summarizeError([{ title: "Deploy", problem: parsed.data.errorSummary || "Build failed" }]),
    }), { idempotencyKey: `${FIX_APP}-${hash}${parsed.data.forcePayment ? "-pay" : ""}` });
    if (!session.url) return Response.json({ error: "Checkout could not be opened. Nothing was charged." }, { status: 503, headers: noStore });
    return Response.json({ promo: false, url: session.url }, { headers: noStore });
  } catch (error) {
    if (error instanceof PatchError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
    const message = error instanceof Error && /not enabled|not configured/i.test(error.message) ? error.message : "Checkout could not be started. Nothing was charged.";
    return Response.json({ error: message }, { status: 503, headers: noStore });
  }
}
