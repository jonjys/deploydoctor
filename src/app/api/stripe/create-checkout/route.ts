import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { customerSession, cookieOptions } from "@/lib/access";
import { checkoutContext, checkoutSessionParams, isProbeHeader } from "@/lib/checkout-guard";
import { digest } from "@/lib/session-token";
import { isPlan, isScanPlan } from "@/lib/plans";
import { getReport } from "@/lib/reports";
import { priceFor, sameOrigin, stripeClient } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";
import { appOrigin } from "@/lib/site";
import { FIX_SERVICE_ENABLED, isFixPlan } from "@/lib/fix-service";

function probeResponse() {
  return Response.json({ ok: true, skipped: "probe" });
}

export async function POST(request: Request) {
  if (isProbeHeader(request.headers)) return probeResponse();
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 5000) return Response.json({ error: t(lang, "pay.tooLarge") }, { status: 413 });
    const body = JSON.parse(text) as { plan?: unknown; reportId?: unknown; checkId?: unknown; context?: unknown };
    if (!isPlan(body.plan)) return Response.json({ error: t(lang, "pay.badPlan") }, { status: 400 });
    const plan = body.plan;
    if (isFixPlan(plan) && !FIX_SERVICE_ENABLED) return Response.json({ error: t(lang, "pay.fixPaused") }, { status: 409 });
    let reportId = "";
    let checkId = "";
    if (!isScanPlan(plan)) {
      if (typeof body.reportId !== "string") return Response.json({ error: t(lang, "pay.needReport") }, { status: 400 });
      const report = await getReport(body.reportId);
      if (!report) return Response.json({ error: t(lang, "pay.reportNotFound") }, { status: 404 });
      const failures = report.results.checks.filter((check) => check.status === "red");
      if (!failures.length || (plan === "fix-one" && !failures.some((check) => check.id === body.checkId))) {
        return Response.json({ error: t(lang, "pay.needRed") }, { status: 400 });
      }
      reportId = report.id;
      checkId = plan === "fix-one" ? String(body.checkId) : "";
    }
    const stripe = stripeClient();
    const existing = await customerSession();
    const nonce = randomBytes(32).toString("hex");
    const origin = appOrigin(request);
    const session = await stripe.checkout.sessions.create(checkoutSessionParams({
      plan, lang, reportId, checkId, context: checkoutContext(body.context), browser: digest(`checkout:${nonce}`),
      origin, customerId: existing?.customerId, lineItem: priceFor(plan, lang),
      integrationIdentifier: `deploydoctor-${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + b % 26)).join("")}`,
    }));
    (await cookies()).set("dd_checkout", nonce, { ...cookieOptions, maxAge: 24 * 60 * 60 });
    return Response.json({ url: session.url });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "pay.invalidJson") }, { status: 400 });
    console.error(
      "Checkout creation failed",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
    return Response.json({ error: t(lang, "pay.startFailed") }, { status: 503 });
  }
}
