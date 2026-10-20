import { cookies } from "next/headers";
import { cookieOptions, hashRequestIp } from "@/lib/access";
import { boundedBody } from "@/lib/bounded-body";
import { patchRules } from "@/lib/budget-policy";
import { acquireWork, workLimitResponse } from "@/lib/work-budget";
import { langFromRequest, t } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_HEADERS, restorePatchPurchase } from "@/lib/patch/delivery";
import { PATCH_ACCESS_COOKIE, withAccessKey } from "@/lib/patch/payments";
import { retrievePaidPatch } from "@/lib/patch/service";
import { sameOrigin } from "@/lib/stripe";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403, headers: PATCH_HEADERS });
  try {
    await acquireWork(patchRules(hashRequestIp(request), "restore"));
    const body = JSON.parse(await boundedBody(request, 1000)) as { sessionId?: unknown; recoveryKey?: unknown };
    if (typeof body.sessionId !== "string" || typeof body.recoveryKey !== "string") throw new PatchError("Invalid recovery details.", 403, "access");
    const href = await restorePatchPurchase(body.sessionId.trim(), body.recoveryKey.trim(), retrievePaidPatch);
    const store = await cookies();
    store.set(PATCH_ACCESS_COOKIE, withAccessKey(store.get(PATCH_ACCESS_COOKIE)?.value, body.recoveryKey.trim()), { ...cookieOptions, maxAge: 365 * 86400 });
    return Response.json({ href }, { headers: PATCH_HEADERS });
  } catch (error) {
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    return Response.json({ error: t(lang, "patch.restore.failed") }, {
      status: error instanceof PatchError ? error.status : error instanceof SyntaxError || error instanceof RangeError ? 400 : 503,
      headers: PATCH_HEADERS,
    });
  }
}
