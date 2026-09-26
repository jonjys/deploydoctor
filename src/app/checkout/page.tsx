import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { CheckoutForm } from "@/components/checkout-form";
import { isPlan, isScanPlan, plans } from "@/lib/plans";
import { getReport } from "@/lib/reports";

export default async function Checkout({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (!isPlan(params.plan)) notFound();
  const plan = params.plan;
  const reportId = typeof params.report === "string" ? params.report : undefined;
  const checkId = typeof params.check === "string" ? params.check : undefined;
  let report;
  if (!isScanPlan(plan)) {
    report = reportId ? await getReport(reportId) : null;
    if (!report || !report.results.checks.some((check) => check.status === "red" && (plan === "fix-all" || check.id === checkId))) notFound();
  }
  const item = plans[plan];
  const configured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (!item.env || process.env[item.env]));
  return <main className="site-shell"><SiteNav /><section className="checkout-card"><p className="section-kicker">YOUR NEXT STEP</p>
    <h1>{item.name}</h1><p className="price">{item.price}<small>{item.cadence}</small></p>
    {report && <p>{report.repo_url}<br />{plan === "fix-one" ? `Kontroll: ${checkId}` : "Alla röda kontroller i rapporten"}</p>}
    {!isScanPlan(plan) && <p>Vi granskar rapporten manuellt och levererar en kodpatch. Inga ändringar görs automatiskt i ditt repo.</p>}
    <CheckoutForm plan={plan} reportId={reportId} checkId={checkId} configured={configured} />
  </section></main>;
}
