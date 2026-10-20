import { createHmac, timingSafeEqual } from "node:crypto";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_FILENAME } from "@/lib/patch/payments";
import { tokenHash } from "@/lib/patch/quote";

export const PATCH_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export const SESSION_ID = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/;
const ACCESS_KEY = /^[a-f0-9]{64}$/;
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`deploydoctor:patch-download:${payload}`).digest("hex");

/** A link alone never grants access: its signature, lifetime AND the owner's cookie must match. */
export function downloadToken(sessionId: string, accessHash: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sessionId, accessHash, expiresAt: Math.floor(now / 1000) + 900 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyDownloadToken(token: string, sessionId: string, accessKeys: string[], secret: string, now = Date.now()) {
  const match = /^([A-Za-z0-9_-]{1,800})\.([a-f0-9]{64})$/.exec(token);
  if (!match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(sign(match[1], secret))))
    throw new PatchError("The download link is invalid. Reload the order page.", 410, "link");
  let payload;
  try { payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as { sessionId: string; accessHash: string; expiresAt: number }; }
  catch { throw new PatchError("Invalid download link.", 410, "link"); }
  if (payload.sessionId !== sessionId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Math.floor(now / 1000))
    throw new PatchError("The download link expired. Reload the order page.", 410, "link");
  if (!accessKeys.some(key => ACCESS_KEY.test(key) && tokenHash(key) === payload.accessHash))
    throw new PatchError("This download belongs to another browser. Restore your purchase first.", 403, "access");
}

export async function paidPatchResponse(request: Request, keys: string[], secret: string,
  loadOrder: (id: string, accessKeys: string[]) => Promise<{ patch: string }>) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("session_id") ?? "";
  verifyDownloadToken(params.get("token") ?? "", sessionId, keys, secret);
  const order = await loadOrder(sessionId, keys); // Always rechecks Stripe; never trust a previously paid flag.
  return new Response(order.patch, { headers: { ...PATCH_HEADERS, "Content-Type": "text/x-diff; charset=utf-8",
    "Content-Disposition": `attachment; filename="${PATCH_FILENAME}"` } });
}

/** Recovery uses a high-entropy saved key, never an email address or a guessable order ID alone. */
export async function restorePatchPurchase(sessionId: string, recoveryKey: string,
  loadOrder: (id: string, keys: string[]) => Promise<unknown>) {
  if (!SESSION_ID.test(sessionId) || !ACCESS_KEY.test(recoveryKey)) throw new PatchError("Invalid recovery details.", 403, "access");
  await loadOrder(sessionId, [recoveryKey]);
  return `/patch/success?session_id=${encodeURIComponent(sessionId)}`;
}
