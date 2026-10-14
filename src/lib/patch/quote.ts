import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { z } from "zod";
import { PatchError } from "@/lib/patch/case-patch";

/**
 * A quote is the prepared patch plus what it was built from, encrypted and authenticated so the browser
 * can carry it to checkout and Stripe can hold it until payment. No database row is needed: the paid
 * patch is recovered from the Checkout Session itself. Ported from ImportFix (src/lib/import-quote.ts),
 * with the patch compressed so a multi-file fix still fits in Stripe metadata.
 */
const quoteSchema = z.object({
  version: z.literal(1), createdAt: z.number(), expiresAt: z.number(),
  reportId: z.string().uuid(), repoUrl: z.string().url(), commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.array(z.string().max(220)).min(1).max(20), fixes: z.number().int().positive(), patch: z.string().max(24_000),
  accessKey: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.string().regex(/^[a-f0-9]{32}$/),
});
export type PatchQuote = z.infer<typeof quoteSchema>;
export type QuoteInput = Omit<PatchQuote, "version" | "accessKey" | "nonce" | "createdAt" | "expiresAt">;

const QUOTE_HOURS = 24;
// Stripe metadata allows 50 keys of 500 characters; the quote takes at most 28 of them.
const CHUNK = 450;
const MAX_CHUNKS = 28;
export const MAX_TOKEN_LENGTH = CHUNK * MAX_CHUNKS;

/** Derived from SESSION_SECRET under its own label, so no new secret has to be configured. */
function encryptionKey(secret: string) {
  if (secret.length < 32) throw new Error("Quote protection is not configured.");
  return createHmac("sha256", secret).update("patchjouren:quote:encryption:v1").digest();
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function sealQuote(data: QuoteInput, secret: string, now = Date.now()) {
  const quote: PatchQuote = quoteSchema.parse({ ...data, version: 1, createdAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + QUOTE_HOURS * 3600, accessKey: randomBytes(32).toString("hex"), nonce: randomBytes(16).toString("hex") });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(deflateRawSync(JSON.stringify(quote))), cipher.final()]);
  const token = `p1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new PatchError("The patch is too large for automatic delivery.", 422, "too-large");
  return { quote, token };
}

/**
 * `requireFresh` is for starting a checkout: Stripe needs at least 30 minutes left on the session.
 * A paid quote is opened without it, so a patch stays retrievable after the quote itself expired.
 */
export function openQuote(token: string, secret: string, requireFresh = true, now = Date.now()): PatchQuote {
  try {
    if (!/^p1\.[A-Za-z0-9_-]{50,12600}$/.test(token)) throw new Error("format");
    const bytes = Buffer.from(token.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const json = inflateRawSync(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]), { maxOutputLength: 64_000 }).toString("utf8");
    const quote = quoteSchema.parse(JSON.parse(json));
    if (requireFresh && quote.expiresAt < Math.floor(now / 1000) + 1860) throw new Error("expired");
    return quote;
  } catch {
    throw requireFresh
      ? new PatchError("The offer has expired or is invalid. Check the repository again; nothing was charged.", 400, "expired")
      : new PatchError("The paid patch could not be read. Contact support with your order ID; do not buy it again.", 503, "delivery");
  }
}

export function quoteMetadata(token: string, accessKey: string, reportId: string): Record<string, string> {
  const chunks = token.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [];
  if (!chunks.length || chunks.length > MAX_CHUNKS) throw new PatchError("The patch is too large for automatic delivery.", 422, "too-large");
  return { app: "patchjouren", report_id: reportId, quote_hash: tokenHash(token), access_hash: tokenHash(accessKey),
    quote_parts: String(chunks.length), ...Object.fromEntries(chunks.map((chunk, index) => [`quote_${index}`, chunk])) };
}

export function tokenFromMetadata(metadata: Record<string, string>): string {
  const count = Number(metadata.quote_parts);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) throw new PatchError("Order delivery data is unavailable.", 503, "delivery");
  const token = Array.from({ length: count }, (_, index) => metadata[`quote_${index}`] ?? "").join("");
  if (tokenHash(token) !== metadata.quote_hash) throw new PatchError("Order delivery data is invalid.", 503, "delivery");
  return token;
}
