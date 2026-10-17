import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { BillingPortalButton } from "@/components/billing-portal-button";
import { CiTokenButton } from "@/components/ci-token-button";
import { activePlan, customerSession } from "@/lib/access";
import { db, query } from "@/lib/db";
import { getT } from "@/lib/lang";
import { dateLocale } from "@/lib/i18n";
import { hasHistory } from "@/lib/plans";
import { watchEnabled } from "@/lib/watch";

export const metadata = { robots: { index: false, follow: false } };

export default async function Account() {
  const { lang, t } = await getT();
  const customer = await customerSession();
  if (!customer) return <main className="site-shell"><SiteNav current="account" /><section className="checkout-card"><h1>{t("nav.myScans")}</h1>
    <p>{t("account.needBrowser")}</p><p><Link href="/restore">{t("account.restore")}</Link></p><Link href="/pricing">{t("account.seePricing")}</Link></section></main>;
  const plan = await activePlan(customer);
  const history = plan && hasHistory(plan.plan) ? await db<Array<{ report_id: string; repo_url: string; is_private: boolean; created_at: string }>>(query("report_history", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "report_id,repo_url,is_private,created_at", order: "created_at.desc", limit: "100",
  })) : [];
  const orders = await db<Array<{ id: string; plan: string; status: string; report_id: string }>>(query("repair_orders", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "id,plan,status,report_id", order: "created_at.desc", limit: "100",
  }));
  return <main className="site-shell"><SiteNav current="account" /><header className="pricing-header"><h1>{t("nav.myScans")}</h1><p>{customer.email}</p>
    {/* A 24-hour pass is stored as a week pass, so a pass shows its end time instead of a plan name. */}
    <p>{!plan ? t("account.noPlan") : hasHistory(plan.plan) ? t("account.active", { plan: t(`plan.${plan.plan}.name`), date: new Date(plan.current_period_end).toLocaleDateString(dateLocale(lang)) })
      : t("account.passActive", { date: new Date(plan.current_period_end).toLocaleString(dateLocale(lang), { timeZone: "UTC", timeZoneName: "short" }) })}</p>
    {/* A pass is a one-time payment with nothing to manage or cancel. Without an active plan the portal stays, for a past_due card, invoices or a lapsed plan. */}
    {plan && !hasHistory(plan.plan) ? <p>{t("account.passNote")}</p> : <BillingPortalButton />}</header><section className="account-list">
    {plan && <><h2>{t("account.ciTitle")}</h2><p>{t("account.ciBody")} <Link href="/ci">{t("account.ciGuide")}</Link></p><CiTokenButton /></>}
    <h2>{t("account.history")}</h2>
    {!plan || !hasHistory(plan.plan) ? <p>{t("account.historyNote")}</p> : history.length ? history.map((report) => <Link key={report.report_id} href={`/r/${report.report_id}`}>
      {report.repo_url} <small>{report.is_private ? t("account.private") : t("account.public")} · {new Date(report.created_at).toLocaleString(dateLocale(lang))}</small></Link>) : <p>{t("account.nextScan")}</p>}
    <h2>{t("account.orders")}</h2>{orders.length ? orders.map((order) => <div key={order.id}><Link href={`/r/${order.report_id}`}>{order.plan === "fix-one" ? t("account.orderOne") : t("account.orderAll")}</Link>
      <p>{order.status === "completed" ? t("account.orderDone") : t("account.orderPaid")}</p>
      {order.status === "completed" && <a href={`/api/repairs/${order.id}/diff`}>{t("account.download")}</a>}</div>) : <p>{t("account.noOrders")}</p>}
    {watchEnabled() && <p className="watch-account">{t("watch.account")}</p>}
  </section></main>;
}
