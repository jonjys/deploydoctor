import { cookies } from "next/headers";
import { z } from "zod";
import { cookieOptions } from "@/lib/access";
import { GitHubApiError } from "@/lib/github";
import { langFromRequest, t } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_ACCESS_COOKIE, PATCH_AMOUNT, withAccessKey } from "@/lib/patch/payments";
import { createPatchCheckout, preparePatch } from "@/lib/patch/service";
import { appOrigin } from "@/lib/site";
import { sameOrigin } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), reportId: z.string().max(64) }),
  // The page shows the price before payment; the request repeats it so the amount is an explicit choice.
  z.object({ action: z.literal("checkout"), quoteToken: z.string().max(13_000), consent: z.literal(true), expectedAmountMinor: z.literal(PATCH_AMOUNT) }),
]);

/** Verified patch: `prepare` checks a report for a verified automatic patch, `checkout` starts the payment for it. */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const raw = await request.text();
    if (raw.length > 14_000) return Response.json({ error: t(lang, "pay.tooLarge") }, { status: 413, headers });
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({ error: t(lang, "patch.badRequest") }, { status: 400, headers });
    const body = parsed.data;
    if (body.action === "prepare") return Response.json(await preparePatch(request, body.reportId), { headers });

    const checkout = await createPatchCheckout(body.quoteToken, appOrigin(request), lang);
    const store = await cookies();
    store.set(PATCH_ACCESS_COOKIE, withAccessKey(store.get(PATCH_ACCESS_COOKIE)?.value, checkout.accessKey), { ...cookieOptions, maxAge: 365 * 86400 });
    return Response.json({ url: checkout.url }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "pay.invalidJson") }, { status: 400, headers });
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    if (error instanceof GitHubApiError) return Response.json({ error: error.localized(lang) }, { status: error.status, headers });
    console.error("Patch request failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return Response.json({ error: t(lang, "patch.unavailable") }, { status: 503, headers });
  }
}
