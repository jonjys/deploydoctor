import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { plans } from "@/lib/plans";

export const metadata = { title: "Pricing — DeployDoctor" };
export default function Pricing() {
  return <main className="site-shell"><SiteNav /><header className="pricing-header">
    <p className="section-kicker">SMALL PRICE. FEWER DEPLOY SURPRISES.</p>
    <h1>Find the problem.<br />Choose your next step.</h1>
    <p>Start free. Saved public reports are always free to view and share.</p>
  </header><section className="pricing-grid" aria-label="Scan plans">
    <article className="price-card"><span className="plan-badge">START HERE</span><h2>Free</h2>
      <p className="price">$0</p><p>3 public scans / day</p><ul><li>Resets at midnight UTC, per IP</li><li>All five checks</li><li>Actionable copy instructions</li><li>Free shareable report links</li></ul><Link className="cta-button" href="/">Scan for free</Link></article>
    {(["week", "public", "private"] as const).map((key) => <article className={`price-card ${key === "public" ? "featured" : ""}`} key={key}>
      <span className="plan-badge">{key === "week" ? "JUST THIS WEEK" : key === "public" ? "MOST POPULAR" : "YOUR PRIVATE CODE"}</span>
      <h2>{plans[key].name}</h2><p className="price">{plans[key].price}<small>{plans[key].cadence}</small></p>
      <ul><li>Unlimited public scans</li><li>Free shareable public reports</li>{key !== "week" && <li>Personal scan history</li>}
        {key === "week" && <li>Expires after 7 days; no renewal</li>}{key === "private" && <li>Private repos with your read-only GitHub token</li>}
        {key !== "week" && <li>Cancel anytime in the billing portal</li>}</ul>
      <Link className="cta-button" href={`/checkout?plan=${key}`}>{key === "week" ? "Get 7 days" : "Choose plan"} →</Link>
    </article>)}
  </section><section className="pricing-notes"><h2>Want us to fix it?</h2><p>Run a scan first: $5 for one failed check, or $25 for all failed checks in that report. Repair purchases are separate from scan plans and include a code patch after manual review.</p>
    <p>Only an email address is required at Stripe Checkout. Card, PayPal, Alipay and Amazon Pay appear when supported for your payment. Paid access is remembered in the browser where you complete checkout.</p>
    <p>Unlimited scans do not remove GitHub’s limits or the scanner’s per-repository file and time limits; incomplete scans are clearly marked.</p>
  </section></main>;
}
