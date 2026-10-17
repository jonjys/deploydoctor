import { db, query } from "@/lib/db";
import { langFromRequest, t } from "@/lib/i18n";
import { sameOrigin } from "@/lib/stripe";
import { hashWatchToken, isWatchToken, watchConfig } from "@/lib/watch";

const LINK_DAYS = 7;

type ConfirmedWatch = { repo_url: string; last_report_id: string | null };

function result(request: Request, state: "confirmed" | "invalid", watch?: ConfirmedWatch) {
  const target = new URL("/watch", request.url);
  target.searchParams.set("state", state);
  if (watch) {
    target.searchParams.set("repo", watch.repo_url.replace(/^https:\/\/github\.com\//, ""));
    if (watch.last_report_id) target.searchParams.set("report", watch.last_report_id);
  }
  return Response.redirect(target, 303);
}

/**
 * Watch this repo, step two: the link in the confirmation email. Opening it changes nothing, because mail security
 * scanners open every link; it shows a page whose button posts the token back here.
 */
export async function GET(request: Request) {
  const lang = langFromRequest(request);
  if (!watchConfig()) return Response.json({ error: t(lang, "watch.unavailable") }, { status: 503 });
  const token = new URL(request.url).searchParams.get("token");
  if (!isWatchToken(token)) return result(request, "invalid");
  const target = new URL("/watch", request.url);
  target.searchParams.set("state", "confirm");
  target.searchParams.set("token", token);
  return Response.redirect(target, 303);
}

/** The confirm button on that page. Only a confirmed watch is ever rescanned or emailed. */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!watchConfig()) return Response.json({ error: t(lang, "watch.unavailable") }, { status: 503 });
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  const token = await request.formData().then((form) => form.get("token"), () => null);
  if (typeof token !== "string" || !isWatchToken(token)) return result(request, "invalid");
  const tokenHash = hashWatchToken(token);
  try {
    const since = new Date(Date.now() - LINK_DAYS * 86_400_000).toISOString();
    const confirmed = await db<ConfirmedWatch[]>(query("repo_watches", {
      token_hash: `eq.${tokenHash}`, confirmed_at: "is.null", unsubscribed_at: "is.null", created_at: `gt.${since}`,
      select: "repo_url,last_report_id",
    }), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ confirmed_at: new Date().toISOString() }) });
    if (confirmed[0]) {
      console.log("dd-funnel", JSON.stringify({ step: "watch_confirmed" }));
      return result(request, "confirmed", confirmed[0]);
    }
    // A second click on the same link still says it worked.
    const existing = await db<ConfirmedWatch[]>(query("repo_watches", {
      token_hash: `eq.${tokenHash}`, confirmed_at: "not.is.null", unsubscribed_at: "is.null", select: "repo_url,last_report_id", limit: "1",
    }));
    return existing[0] ? result(request, "confirmed", existing[0]) : result(request, "invalid");
  } catch (error) {
    console.error("Watch confirmation failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "watch.linkFailed") }, { status: 502 });
  }
}
