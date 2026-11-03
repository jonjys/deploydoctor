import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PatchError } from "@/lib/patch/case-patch";
import { tokenHash } from "@/lib/patch/quote";
import { FIX_PROMO_CAP } from "@/lib/fix-pr/constants";

/** One atomic step of the launch counter. Claimed must already be the stored value. The 51st claim is refused. */
export function claimPromoSlot(claimed: number, cap = FIX_PROMO_CAP): { granted: boolean; claimed: number; cap: number } {
  if (!Number.isInteger(claimed) || claimed < 0 || cap !== FIX_PROMO_CAP) return { granted: false, claimed: 0, cap: FIX_PROMO_CAP };
  if (claimed >= cap) return { granted: false, claimed: cap, cap };
  return { granted: true, claimed: claimed + 1, cap };
}

const receiptSchema = z.object({
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  claimed: z.number().int().min(1).max(FIX_PROMO_CAP),
  exp: z.number().int(),
});

/** Proves a free slot was taken for this exact quote. It does not contain the patch. */
export function sealPromoReceipt(quoteToken: string, claimed: number, secret: string, now = Date.now()): string {
  const payload = receiptSchema.parse({ quoteHash: tokenHash(quoteToken), claimed, exp: now + 30 * 60 * 1000 });
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`deploydoctor:fix-promo:v1:${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function openPromoReceipt(receipt: string, quoteToken: string, secret: string, now = Date.now()): { claimed: number } {
  const parts = receipt.split(".");
  if (parts.length !== 2 || parts[0].length > 2_000 || parts[1].length > 200) throw new PatchError("This free fix is not valid.", 403, "payment");
  const expected = createHmac("sha256", secret).update(`deploydoctor:fix-promo:v1:${parts[0]}`).digest("base64url");
  const got = Buffer.from(parts[1]);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new PatchError("This free fix is not valid.", 403, "payment");
  let parsed: z.infer<typeof receiptSchema>;
  try { parsed = receiptSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))); }
  catch { throw new PatchError("This free fix is not valid.", 403, "payment"); }
  if (parsed.exp < now) throw new PatchError("This free fix expired. Start again. Nothing was charged.", 400, "expired");
  if (parsed.quoteHash !== tokenHash(quoteToken)) throw new PatchError("This free fix does not match the diagnosis.", 403, "payment");
  return { claimed: parsed.claimed };
}
