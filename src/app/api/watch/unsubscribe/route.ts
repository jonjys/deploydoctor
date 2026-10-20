import { db, query } from "@/lib/db";
import { langFromRequest, t } from "@/lib/i18n";
import { verifyUnsubscribeToken, watchConfig } from "@/lib/watch";

async function unsubscribe(watchId: string) {
  await db(query("repo_watches", { id: `eq.${watchId}`, unsubscribed_at: "is.null" }), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
  });
  console.log("dd-funnel", JSON.stringify({ step: "watch_unsubscribed" }));
}

/**
 * The link at the bottom of every watch email. Opening it changes nothing, because mail security scanners open every
 * link; it shows a page whose button posts back here. Unsubscribing twice is fine.
 */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  if (!watchConfig()) return Response.json({ error: t(lang, "watch.unavailable") }, { status: 503 });
  const token = new URL(request.url).searchParams.get("token");
  const target = new URL("/watch", request.url);
  if (!token || !verifyUnsubscribeToken(token)) {
    target.searchParams.set("state", "invalid");
  } else {
    target.searchParams.set("state", "unsubscribe");
    target.searchParams.set("token", token);
  }
  return Response.redirect(target, 303);
}

/**
 * Two callers: the button on the page (a form with from=page, answered with a redirect) and one-click unsubscribe from
 * the mail app (RFC 8058, the List-Unsubscribe-Post header, no browser, answered with JSON).
 */
export async function POST(request: Request) {
  if (!watchConfig()) return Response.json({ error: "Not configured." }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const fromPage = form?.get("from") === "page";
  const watchId = verifyUnsubscribeToken(new URL(request.url).searchParams.get("token"));
  const target = new URL("/watch", request.url);
  if (!watchId) {
    if (fromPage) { target.searchParams.set("state", "invalid"); return Response.redirect(target, 303); }
    return Response.json({ error: "Invalid token." }, { status: 400 });
  }
  try {
    await unsubscribe(watchId);
    if (fromPage) { target.searchParams.set("state", "unsubscribed"); return Response.redirect(target, 303); }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Watch unsubscribe failed:", error instanceof Error ? error.name : "unknown");
    if (fromPage) { target.searchParams.set("state", "failed"); return Response.redirect(target, 303); }
    return Response.json({ error: "Try again later." }, { status: 502 });
  }
}
