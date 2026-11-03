import { diagnosisRules } from "@/lib/budget-policy";
import { acquireWork, releaseWork, workLimitResponse } from "@/lib/work-budget";
import Anthropic from "@anthropic-ai/sdk";
import { activePlan, hashRequestIp, requestCustomer } from "@/lib/access";
import { DiagnoseUnavailable, diagnoseConfigured, diagnoseWithClaude, MAX_LOG_CHARS } from "@/lib/ai-diagnose";
import { sameOrigin } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI diagnosis of a pasted build log. Diagnosis is free: it does not reserve a daily scan.
 * A shared site capacity and a short burst limit still apply so one visitor cannot exhaust the model budget.
 * The exact patch text is withheld; the $5 fix pull request is the paid delivery.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  const { customer, viaToken, invalidToken } = await requestCustomer(request);
  if (invalidToken) return Response.json({ error: t(lang, "err.badToken") }, { status: 401 });
  if (!viaToken && !sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });

  let globalLease: string | null = null;
  let accountLease: string | null = null;
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
    const identity = plan && customer ? customer.customerId : hashRequestIp(request);
    accountLease = await acquireWork([], `ai:${identity}`, 1, 90);
    globalLease = await acquireWork(diagnosisRules(identity, Boolean(plan)), "ai:site", 3, 90);
    console.log("dd-funnel", JSON.stringify({ step: "diagnosis_started", paid: Boolean(plan) }));
    const { diagnosis, usage } = await diagnoseWithClaude(log, lang);
    console.log("dd-diagnose-usage", JSON.stringify({ ...usage, paid: Boolean(plan), verdict: diagnosis.verdict }));
    console.log("dd-funnel", JSON.stringify({ step: "diagnosis_completed", paid: Boolean(plan) }));
    // Pass holders and CLI token users already paid: they keep the patch text. Free visitors get the $5 fix PR offer.
    const patchWithheld = !plan && Boolean(diagnosis.patch.code.trim());
    return Response.json({
      diagnosis: patchWithheld ? { ...diagnosis, patch: { file: diagnosis.patch.file, code: "" } } : diagnosis,
      fix: patchWithheld ? { paywalled: true, priceUsd: 5, href: "/fix" } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    if (error instanceof DiagnoseUnavailable) return Response.json({ error: t(lang, "diag.unavailable") }, { status: 503 });
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: t(lang, "diag.busy") }, { status: 503 });
    console.error("Diagnosis failed:", error instanceof Anthropic.APIError ? `${error.status}` : error instanceof Error ? error.message : "unknown");
    return Response.json({ error: t(lang, "diag.failed") }, { status: 502 });
  } finally {
    if (globalLease) await releaseWork(globalLease);
    if (accountLease) await releaseWork(accountLease);
  }
}
