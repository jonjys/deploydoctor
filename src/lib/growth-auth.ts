import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GROWTH_COOKIE = "dd_growth";
export const GROWTH_SESSION_SECONDS = 8 * 60 * 60;

export function usableGrowthPassword(password: string | undefined): password is string {
  return typeof password === "string" && password.length >= 24;
}

function equalHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function signature(password: string, expiration: string, nonce: string): string {
  return createHmac("sha256", password).update("growth.v1." + expiration + "." + nonce).digest("hex");
}

export function validGrowthPassword(submitted: string, configured: string | undefined): boolean {
  if (!usableGrowthPassword(configured) || submitted.length > 512) return false;
  const candidate = createHmac("sha256", configured).update(submitted).digest("hex");
  const expected = createHmac("sha256", configured).update(configured).digest("hex");
  return equalHex(candidate, expected);
}

export function issueGrowthSession(password: string, now = Date.now()): string {
  if (!usableGrowthPassword(password)) throw new Error("Growth password is not configured.");
  const expires = String(Math.floor(now / 1000) + GROWTH_SESSION_SECONDS);
  const nonce = randomBytes(16).toString("hex");
  return [expires, nonce, signature(password, expires, nonce)].join(".");
}

export function verifyGrowthSession(token: string | undefined, password: string | undefined, now = Date.now()): boolean {
  if (!usableGrowthPassword(password) || !token || token.length > 256) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, nonce, mac] = parts;
  if (!/^[0-9]{10,11}$/.test(expires) || !/^[0-9a-f]{32}$/.test(nonce)) return false;
  const seconds = Number(expires);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= current || seconds > current + GROWTH_SESSION_SECONDS) return false;
  return equalHex(mac, signature(password, expires, nonce));
}
