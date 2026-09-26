import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { customerSession, cookieOptions } from "@/lib/access";
import { digest } from "@/lib/session-token";
import { isPlan, isScanPlan, plans } from "@/lib/plans";
import { getReport } from "@/lib/reports";
import { priceFor, sameOrigin, stripeClient } from "@/lib/stripe";
import { langFromRequest, t } from "@/lib/i18n";

export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 5000) return Response.json({ error: t(lang, "pay.tooLarge") }, { status: 413 });
    const body = JSON.parse(text) as { plan?: unknown; reportId?: unknown; checkId?: unknown; context?: unknown };
    if (!isPlan(body.plan)) return Response.json({ error: t(lang, "pay.badPlan") }, { status: 400 });
    const plan = body.plan;
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
    const origin = new URL(request.url).origin;
    const metadata = { app: "deploydoctor", plan, reportId, checkId,
      context: typeof body.context === "string" ? body.context.slice(0, 300) : "",
      browser: digest(`checkout:${nonce}`) };
    const session = await stripe.checkout.sessions.create({
      mode: plans[plan].mode,
      line_items: [priceFor(plan, lang)],
      locale: lang,
      ...(existing ? { customer: existing.customerId } : plans[plan].mode === "payment" ? { customer_creation: "always" as const } : {}),
      metadata,
      ...(plans[plan].mode === "subscription" ? { subscription_data: { metadata: { app: "deploydoctor", plan } } } : {}),
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout?plan=${plan}${reportId ? `&report=${reportId}&check=${checkId}` : ""}`,
      integration_identifier: `deploydoctor-${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + b % 26)).join("")}`,
      custom_fields: [{ key: "context", label: { type: "custom", custom: t(lang, "pay.field") },
        type: "text", optional: true, text: { maximum_length: 255, ...(metadata.context ? { default_value: metadata.context.slice(0, 255) } : {}) } }],
      // Stripe's Dashboard decides which eligible payment methods to show.
    });
    (await cookies()).set("dd_checkout", nonce, { ...cookieOptions, maxAge: 24 * 60 * 60 });
    return Response.json({ url: session.url });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "pay.invalidJson") }, { status: 400 });
    console.error("Checkout creation failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "pay.startFailed") }, { status: 503 });
  }
}
