import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { cookieOptions, hashRequestIp } from "@/lib/access";
import { boundedBody } from "@/lib/bounded-body";
import { db } from "@/lib/db";
import { digest } from "@/lib/session-token";
import { communityInput, reviewRules } from "@/lib/community-review";
import { acquireWork, workLimitResponse } from "@/lib/work-budget";
import { sameOrigin } from "@/lib/stripe";
import { langFromRequest } from "@/lib/i18n";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const COOKIE = "dd_review_owner";
export async function POST(request: Request) {
  const sv = langFromRequest(request) === "sv";
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const parsed = communityInput.safeParse(JSON.parse(await boundedBody(request, 8000)));
    if (!parsed.success) return Response.json({ error: sv ? "Kontrollera namn, text och betyg. Godkänn publicering för omdömen." : "Check your name, text and rating. Reviews require permission to publish." }, { status: 400, headers });
    await acquireWork(reviewRules(hashRequestIp(request)));
    const store = await cookies();
    const saved = store.get(COOKIE)?.value;
    const owner = saved && /^[a-f0-9]{64}$/.test(saved) ? saved : randomBytes(32).toString("hex");
    const { website: _honeypot, ...input } = parsed.data;
    void _honeypot;
    await db("community_reviews?on_conflict=voter_hash,kind", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ...input, voter_hash: digest(`review:${owner}`), status: "pending", created_at: new Date().toISOString() }),
    });
    store.set(COOKIE, owner, { ...cookieOptions, maxAge: 365 * 86400 });
    return Response.json({ ok: true }, { status: 201, headers });
  } catch (error) {
    const limited = workLimitResponse(error, langFromRequest(request));
    if (limited) return limited;
    if (error instanceof RangeError || error instanceof SyntaxError) return Response.json({ error: sv ? "Texten är för lång eller ogiltig." : "The submission is too large or invalid." }, { status: error instanceof RangeError ? 413 : 400, headers });
    return Response.json({ error: sv ? "Kunde inte spara just nu. Försök igen." : "Could not save right now. Please try again." }, { status: 503, headers });
  }
}
