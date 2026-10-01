import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { BillingPortalButton } from "@/components/billing-portal-button";
import { activePlan, customerSession } from "@/lib/access";
import { db, query } from "@/lib/db";
import { getT } from "@/lib/lang";
import { dateLocale } from "@/lib/i18n";

export default async function Account() {
  const { lang, t } = await getT();
  const customer = await customerSession();
  if (!customer) return <main className="site-shell"><SiteNav current="account" /><section className="checkout-card"><h1>{t("nav.myScans")}</h1>
    <p>{t("account.needBrowser")}</p><p><Link href="/restore">{t("account.restore")}</Link></p><Link href="/pricing">{t("account.seePricing")}</Link></section></main>;
  const plan = await activePlan(customer);
  const history = plan && plan.plan !== "week" ? await db<Array<{ report_id: string; repo_url: string; is_private: boolean; created_at: string }>>(query("report_history", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "report_id,repo_url,is_private,created_at", order: "created_at.desc", limit: "100",
  })) : [];
  const orders = await db<Array<{ id: string; plan: string; status: string; report_id: string }>>(query("repair_orders", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "id,plan,status,report_id", order: "created_at.desc", limit: "100",
  }));
  return <main className="site-shell"><SiteNav current="account" /><header className="pricing-header"><h1>{t("nav.myScans")}</h1><p>{customer.email}</p>
    <p>{plan ? t("account.active", { plan: t(`plan.${plan.plan}.name`), date: new Date(plan.current_period_end).toLocaleDateString(dateLocale(lang)) }) : t("account.noPlan")}</p>
    {/* A 7-day pass is a one-time payment: there is no subscription to manage or cancel. */}
    {plan?.plan === "week" ? <p>{t("account.passNote")}</p> : <BillingPortalButton />}</header><section className="account-list"><h2>{t("account.history")}</h2>
    {!plan || plan.plan === "week" ? <p>{t("account.historyNote")}</p> : history.length ? history.map((report) => <Link key={report.report_id} href={`/r/${report.report_id}`}>
      {report.repo_url} <small>{report.is_private ? t("account.private") : t("account.public")} · {new Date(report.created_at).toLocaleString(dateLocale(lang))}</small></Link>) : <p>{t("account.nextScan")}</p>}
    <h2>{t("account.orders")}</h2>{orders.length ? orders.map((order) => <div key={order.id}><Link href={`/r/${order.report_id}`}>{order.plan === "fix-one" ? t("account.orderOne") : t("account.orderAll")}</Link>
      <p>{order.status === "completed" ? t("account.orderDone") : t("account.orderPaid")}</p>
      {order.status === "completed" && <a href={`/api/repairs/${order.id}/diff`}>{t("account.download")}</a>}</div>) : <p>{t("account.noOrders")}</p>}
  </section></main>;
}
