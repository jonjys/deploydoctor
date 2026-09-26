import { createHmac, timingSafeEqual } from "node:crypto";

export type CustomerSession = { email: string; customerId: string; expiresAt: number };
export function signingSecret(): string {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) throw new Error("Session signing is not configured.");
  return key;
}
export function digest(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("hex");
}
export function signSession(session: CustomerSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${digest(`session:${payload}`)}`;
}
export function verifySession(token?: string): CustomerSession | null {
  if (!token || token.length > 2000) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (extra || !/^[a-f0-9]{64}$/.test(signature || "")) return null;
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest(`session:${payload}`), "hex"))) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as CustomerSession;
    if (typeof value.email !== "string" || !/^cus_[A-Za-z0-9]+$/.test(value.customerId) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    return value;
  } catch { return null; }
}
