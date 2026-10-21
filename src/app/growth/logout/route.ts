import { cookies } from "next/headers";
import { GROWTH_COOKIE } from "@/lib/growth-auth";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
  (await cookies()).delete({ name: GROWTH_COOKIE, path: "/growth" });
  return Response.redirect(new URL("/growth", request.url), 303);
}
