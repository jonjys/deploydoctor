import "server-only";
import { cookies } from "next/headers";
import { db, query, rpc } from "@/lib/db";
import { digest, verifySession, type CustomerSession } from "@/lib/session-token";

export const SESSION_COOKIE = "dd_customer";
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
export type Entitlement = {
  id: string; email: string; plan: "week" | "public" | "private"; status: string;
  stripe_customer_id: string; current_period_end: string;
};
export async function customerSession() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
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
export async function reserveScan(request: Request) {
  const id = crypto.randomUUID();
  const result = await rpc<{ allowed: boolean; remaining: number; resetsAt: string }>("reserve_scan", {
    p_ip_hash: hashRequestIp(request), p_id: id,
  });
  return { ...result, id };
}
export async function finishScan(id: string, success: boolean) {
  await rpc("finish_scan", { p_id: id, p_success: success });
}
