import { cookies } from "next/headers";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_ACCESS_COOKIE, PATCH_FILENAME, readAccessKeys } from "@/lib/patch/payments";
import { retrievePaidPatch } from "@/lib/patch/service";

export const runtime = "nodejs";

/** The paid patch as a file, for the browser that bought it. Every download re-checks the payment with Stripe. */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  try {
    const order = await retrievePaidPatch(sessionId, readAccessKeys((await cookies()).get(PATCH_ACCESS_COOKIE)?.value));
    return new Response(order.patch, { headers: { "Content-Type": "text/x-diff; charset=utf-8",
      "Content-Disposition": `attachment; filename="${PATCH_FILENAME}"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof PatchError ? error.status : 503;
    return new Response(error instanceof PatchError ? error.message : "The patch is unavailable right now.", {
      status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
}
