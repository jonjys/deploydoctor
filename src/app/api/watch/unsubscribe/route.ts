import { db, query } from "@/lib/db";
import { langFromRequest, t } from "@/lib/i18n";
import { verifyUnsubscribeToken, watchConfig } from "@/lib/watch";

async function unsubscribe(watchId: string) {
  await db(query("repo_watches", { id: `eq.${watchId}`, unsubscribed_at: "is.null" }), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
  });
  console.log("dd-funnel", JSON.stringify({ step: "watch_unsubscribed" }));
}

/** The one-click link at the bottom of every watch email. Unsubscribing twice is fine. */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  if (!watchConfig()) return Response.json({ error: t(lang, "watch.unavailable") }, { status: 503 });
  const watchId = verifyUnsubscribeToken(new URL(request.url).searchParams.get("token"));
  const target = new URL("/watch", request.url);
  target.searchParams.set("state", watchId ? "unsubscribed" : "invalid");
  if (!watchId) return Response.redirect(target, 303);
  try {
    await unsubscribe(watchId);
    return Response.redirect(target, 303);
  } catch (error) {
    console.error("Watch unsubscribe failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "watch.linkFailed") }, { status: 502 });
  }
}

/** One-click unsubscribe from the mail app (RFC 8058): the List-Unsubscribe-Post header points here, without a browser. */
export async function POST(request: Request) {
  if (!watchConfig()) return Response.json({ error: "Not configured." }, { status: 503 });
  const watchId = verifyUnsubscribeToken(new URL(request.url).searchParams.get("token"));
  if (!watchId) return Response.json({ error: "Invalid token." }, { status: 400 });
  try {
    await unsubscribe(watchId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Watch unsubscribe failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Try again later." }, { status: 502 });
  }
}
