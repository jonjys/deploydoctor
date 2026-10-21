import { cookies } from "next/headers";
import { GROWTH_COOKIE, GROWTH_SESSION_SECONDS, issueGrowthSession, validGrowthPassword } from "@/lib/growth-auth";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const size = Number(request.headers.get("content-length") || "0");
  if (size > 4096) return new Response("Invalid request", { status: 413 });
  const form = await request.formData().catch(() => null);
  const submitted = form?.get("password");
  const password = process.env.GROWTH_DASHBOARD_PASSWORD;
  if (typeof submitted !== "string" || !validGrowthPassword(submitted, password)) {
    return Response.redirect(new URL("/growth?error=1", request.url), 303);
  }
  (await cookies()).set(GROWTH_COOKIE, issueGrowthSession(password!), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/growth", maxAge: GROWTH_SESSION_SECONDS,
  });
  return Response.redirect(new URL("/growth", request.url), 303);
}
