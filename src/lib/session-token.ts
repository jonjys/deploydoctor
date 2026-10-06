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
  return verifySigned(token, "session");
}

/**
 * API tokens let CI (the GitHub Action) and scripts call /api/reports as a paying customer.
 * They are signed like the session cookie but under their own namespace, so a token never
 * works as a cookie and a cookie never works as a token. The pass itself is still checked
 * on every request, so a token stops working the moment the pass ends.
 */
export const API_TOKEN_PREFIX = "ddt_";
const API_TOKEN_DAYS = 365;
export function signApiToken(customer: Pick<CustomerSession, "email" | "customerId">): string {
  const session: CustomerSession = { ...customer, expiresAt: Date.now() + API_TOKEN_DAYS * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${API_TOKEN_PREFIX}${payload}.${digest(`api:${payload}`)}`;
}
export function verifyApiToken(token?: string): CustomerSession | null {
  if (!token?.startsWith(API_TOKEN_PREFIX)) return null;
  return verifySigned(token.slice(API_TOKEN_PREFIX.length), "api");
}

function verifySigned(token: string | undefined, namespace: "session" | "api"): CustomerSession | null {
  if (!token || token.length > 2000) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (extra || !/^[a-f0-9]{64}$/.test(signature || "")) return null;
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest(`${namespace}:${payload}`), "hex"))) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as CustomerSession;
    if (typeof value.email !== "string" || !/^cus_[A-Za-z0-9]+$/.test(value.customerId) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    return value;
  } catch { return null; }
}
