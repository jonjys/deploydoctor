import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { CheckoutForm } from "@/components/checkout-form";
import { isPlan, isScanPlan, planPrice, plans } from "@/lib/plans";
import { getReport } from "@/lib/reports";
import { getT } from "@/lib/lang";
import { FIX_SERVICE_ENABLED, isFixPlan } from "@/lib/fix-service";
import Link from "next/link";

export const metadata = { robots: { index: false, follow: false } };

export default async function Checkout({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { t, lang } = await getT();
  if (!isPlan(params.plan)) notFound();
  const plan = params.plan;
  const reportId = typeof params.report === "string" ? params.report : undefined;
  if (isFixPlan(plan) && !FIX_SERVICE_ENABLED) {
    return <main className="site-shell"><SiteNav /><section className="checkout-card"><p className="section-kicker">{t("checkout.kicker")}</p>
      <h1>{t("checkout.fixPausedTitle")}</h1><p>{t("checkout.fixPaused")}</p>
      <Link className="cta-button" href={reportId ? `/r/${reportId}` : "/"}>{reportId ? t("checkout.backToReport") : t("nav.scan")} →</Link>
    </section></main>;
  }
  const checkId = typeof params.check === "string" ? params.check : undefined;
  let report;
  if (!isScanPlan(plan)) {
    report = reportId ? await getReport(reportId) : null;
    if (!report || !report.results.checks.some((check) => check.status === "red" && (plan === "fix-all" || check.id === checkId))) notFound();
  }
  const item = plans[plan];
  const configured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (!item.env || process.env[item.env]));
  return <main className="site-shell"><SiteNav /><section className="checkout-card"><p className="section-kicker">{t("checkout.kicker")}</p>
    <h1>{t(`plan.${plan}.name`)}</h1><p className="price">{planPrice(plan, lang)}<small>{t(`plan.${plan}.cadence`)}</small></p>
    {report && <p>{report.repo_url}<br />{plan === "fix-one" ? t("checkout.check", { check: checkId ?? "" }) : t("checkout.allRed")}</p>}
    {!isScanPlan(plan) && <p>{t("checkout.manual")}</p>}
    <CheckoutForm plan={plan} reportId={reportId} checkId={checkId} configured={configured} />
  </section></main>;
}
