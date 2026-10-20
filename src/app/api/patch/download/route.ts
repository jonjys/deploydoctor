import { cookies } from "next/headers";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_ACCESS_COOKIE, readAccessKeys } from "@/lib/patch/payments";
import { retrievePaidPatch } from "@/lib/patch/service";
import { signingSecret } from "@/lib/session-token";
import { paidPatchResponse, PATCH_HEADERS } from "@/lib/patch/delivery";
import { workLimitResponse } from "@/lib/work-budget";
import { langFromRequest } from "@/lib/i18n";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return await paidPatchResponse(request, readAccessKeys((await cookies()).get(PATCH_ACCESS_COOKIE)?.value), signingSecret(), retrievePaidPatch);
  } catch (error) {
    const limited = workLimitResponse(error, langFromRequest(request));
    if (limited) return limited;
    return new Response(error instanceof PatchError ? error.message : "The patch is unavailable right now.", {
      status: error instanceof PatchError ? error.status : 503,
      headers: { ...PATCH_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
