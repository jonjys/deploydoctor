import "server-only";
import { cookies } from "next/headers";
import { db, query, rpc } from "@/lib/db";
import { digest, verifyApiToken, verifySession, type CustomerSession } from "@/lib/session-token";

export const SESSION_COOKIE = "dd_customer";
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
export type Entitlement = {
  id: string; email: string; plan: "week" | "public" | "private"; status: string;
  stripe_customer_id: string; current_period_end: string;
};
export async function customerSession() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}
/** The API token from an Authorization header, or null when the request carries none. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return match ? match[1] : null;
}
/**
 * Who is calling an API route: a CI token when one is sent, otherwise the browser cookie.
 * A token that does not verify is an error (the caller clearly meant to authenticate), never a silent fallback to the cookie.
 */
export async function requestCustomer(request: Request): Promise<{ customer: CustomerSession | null; viaToken: boolean; invalidToken: boolean }> {
  const token = bearerToken(request);
  if (token === null) return { customer: await customerSession(), viaToken: false, invalidToken: false };
  const customer = verifyApiToken(token);
  return { customer, viaToken: true, invalidToken: customer === null };
}
export async function activePlan(session: CustomerSession | null): Promise<Entitlement | null> {
  if (!session) return null;
  const rows = await db<Entitlement[]>(query("subscriptions", {
    stripe_customer_id: `eq.${session.customerId}`, email: `eq.${session.email}`,
    status: "in.(active,trialing)", current_period_end: `gt.${new Date().toISOString()}`, select: "*",
  }));
  return rows.find((row) => row.plan === "private") ?? rows.find((row) => row.plan === "public") ?? rows[0] ?? null;
}
export function hashRequestIp(request: Request) {
  // Vercel overwrites this header at its trusted edge; never trust client x-forwarded-for.
  const ip = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : "local-development";
  if (!ip) throw new Error("Could not check today's scan allowance; try again.");
  return digest(`ip:${ip}`);
}
/** Reserves one of today's free scans: per visitor IP, or per repository for free GitHub Action scans. */
export async function reserveScan(request: Request, key?: string) {
  const id = crypto.randomUUID();
  const result = await rpc<{ allowed: boolean; remaining: number; resetsAt: string }>("reserve_scan", {
    p_ip_hash: key ? digest(key) : hashRequestIp(request), p_id: id,
  });
  return { ...result, id };
}
export async function finishScan(id: string, success: boolean) {
  await rpc("finish_scan", { p_id: id, p_success: success });
}
