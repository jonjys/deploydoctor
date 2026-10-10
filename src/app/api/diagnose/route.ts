import Anthropic from "@anthropic-ai/sdk";
import { activePlan, finishScan, hashRequestIp, requestCustomer, reserveScan } from "@/lib/access";
import { DiagnoseUnavailable, diagnoseConfigured, diagnoseWithClaude, MAX_LOG_CHARS } from "@/lib/ai-diagnose";
import { sameOrigin } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI diagnosis of a pasted build log. Free visitors get the daily allowance that reserve_scan enforces,
 * counted under its own key so it never uses up their repository scans; any active pass is unlimited.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  const { customer, viaToken, invalidToken } = await requestCustomer(request);
  if (invalidToken) return Response.json({ error: t(lang, "err.badToken") }, { status: 401 });
  if (!viaToken && !sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });

  let reservation: string | undefined;
  let done = false;
  try {
    const raw = await request.text();
    if (raw.length > MAX_LOG_CHARS + 2_000) return Response.json({ error: t(lang, "diag.tooLong") }, { status: 413 });
    const body = JSON.parse(raw) as { log?: unknown };
    const log = typeof body.log === "string" ? body.log.trim() : "";
    if (log.length < 20) return Response.json({ error: t(lang, "diag.tooShort") }, { status: 400 });
    if (log.length > MAX_LOG_CHARS) return Response.json({ error: t(lang, "diag.tooLong") }, { status: 413 });

    // Never take a free diagnosis when the model cannot run.
    if (!diagnoseConfigured()) throw new DiagnoseUnavailable();
    const plan = await activePlan(customer);
    if (!plan) {
      const quota = await reserveScan(request, `diagnose:${hashRequestIp(request)}`);
      if (!quota.allowed) return Response.json({ error: t(lang, "diag.limit"), paywall: true, resetsAt: quota.resetsAt }, { status: 429 });
      reservation = quota.id;
    }

    const { diagnosis, usage } = await diagnoseWithClaude(log, lang);
    console.log("dd-diagnose-usage", JSON.stringify({ ...usage, paid: Boolean(plan), verdict: diagnosis.verdict }));
    done = true;
    return Response.json({ diagnosis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    if (error instanceof DiagnoseUnavailable) return Response.json({ error: t(lang, "diag.unavailable") }, { status: 503 });
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: t(lang, "diag.busy") }, { status: 503 });
    console.error("Diagnosis failed:", error instanceof Anthropic.APIError ? `${error.status}` : error instanceof Error ? error.message : "unknown");
    return Response.json({ error: t(lang, "diag.failed") }, { status: 502 });
  } finally {
    // A failed diagnosis gives the free allowance back.
    if (reservation) await finishScan(reservation, done).catch(() => console.error("Diagnose quota completion failed"));
  }
}
