import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { BillingPortalButton } from "@/components/billing-portal-button";
import { activePlan, customerSession } from "@/lib/access";
import { db, query } from "@/lib/db";

export default async function Account() {
  const customer = await customerSession();
  if (!customer) return <main className="site-shell"><SiteNav /><section className="checkout-card"><h1>My scans</h1>
    <p>Öppna sidan i webbläsaren där du slutförde betalningen. Gratisrapporter nås alltid via sina sparade länkar.</p><Link href="/pricing">Se priser</Link></section></main>;
  const plan = await activePlan(customer);
  const history = plan && plan.plan !== "week" ? await db<Array<{ report_id: string; repo_url: string; is_private: boolean; created_at: string }>>(query("report_history", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "report_id,repo_url,is_private,created_at", order: "created_at.desc", limit: "100",
  })) : [];
  const orders = await db<Array<{ id: string; plan: string; status: string; report_id: string }>>(query("repair_orders", {
    stripe_customer_id: `eq.${customer.customerId}`, select: "id,plan,status,report_id", order: "created_at.desc", limit: "100",
  }));
  return <main className="site-shell"><SiteNav /><header className="pricing-header"><h1>My scans</h1><p>{customer.email}</p>
    <p>{plan ? `${plan.plan} · aktivt till ${new Date(plan.current_period_end).toLocaleDateString("sv-SE")}` : "Inget aktivt pass; 3 gratis skanningar per dag."}</p>
    <BillingPortalButton /></header><section className="account-list"><h2>History</h2>
    {!plan || plan.plan === "week" ? <p>Historik ingår i $9- och $19-planerna. Rapportlänkarna fungerar fortfarande.</p> : history.length ? history.map((report) => <Link key={report.report_id} href={`/r/${report.report_id}`}>
      {report.repo_url} <small>{report.is_private ? "Private" : "Public"} · {new Date(report.created_at).toLocaleString("sv-SE")}</small></Link>) : <p>Din nästa skanning visas här.</p>}
    <h2>Fixbeställningar</h2>{orders.length ? orders.map((order) => <div key={order.id}><Link href={`/r/${order.report_id}`}>{order.plan === "fix-one" ? "En kontroll" : "Alla röda kontroller"}</Link>
      <p>{order.status === "completed" ? "Kodpatch klar" : "Betald · väntar på manuell granskning"}</p>
      {order.status === "completed" && <a href={`/api/repairs/${order.id}/diff`}>Ladda ner kodpatch</a>}</div>) : <p>Inga fixbeställningar ännu.</p>}
  </section></main>;
}
