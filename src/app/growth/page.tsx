import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import "./growth.css";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { GrowthCalculator } from "@/components/growth-calculator";
import { GROWTH_COOKIE, usableGrowthPassword, verifyGrowthSession } from "@/lib/growth-auth";
import { FindingStats } from "@/components/finding-stats";
import { scanInsights } from "@/lib/scan-insights-store";
import { scansInWindow } from "@/lib/scan-insights";
import { readGrowthReport } from "@/lib/growth-data";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private Growth HQ | DeployDoctor",
  robots: { index: false, follow: false, noarchive: true },
};

const KICKER = "PRIVATE • DEPLOYDOCTOR";

function num(value: number) { return value.toLocaleString("en-US"); }
function money(currency: string, minorUnits: number) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minorUnits / 100); }
  catch { return currency + " " + (minorUnits / 100).toFixed(2); }
}

export default async function GrowthPage({
  searchParams,
}: { searchParams: Promise<{ days?: string; error?: string }> }) {
  const params = await searchParams;
  const password = process.env.GROWTH_DASHBOARD_PASSWORD;
  const configured = usableGrowthPassword(password);
  if (!configured) {
    // Visitors get the ordinary 404; the setup hint belongs in the server log, not on a public page.
    console.warn("Growth HQ is not configured: set GROWTH_DASHBOARD_PASSWORD (at least 24 characters) in Vercel Production, then redeploy.");
    notFound();
  }
  const cookie = (await cookies()).get(GROWTH_COOKIE)?.value;
  const authorized = verifyGrowthSession(cookie, password);
  if (!authorized) return <main className="site-shell">
    <SiteNav />
    <section className="growth-entrance">
      <p className="section-kicker">{KICKER}</p>
      <h1>Growth HQ</h1>
      <p>Owner-only traffic, sales and SEO measurements. This page is not visible to ordinary customers.</p>
      <form action="/growth/session" method="post" className="growth-login">
        <label htmlFor="growth-password">Dashboard password</label>
        <input id="growth-password" name="password" type="password" minLength={24} required autoComplete="current-password" />
        <button className="cta-button" type="submit">Unlock dashboard →</button>
        {params.error === "1" && <p role="alert">Incorrect password.</p>}
      </form>
    </section>
  </main>;
  const days = params.days === "7" ? 7 : 30;
  const [report, insights] = await Promise.all([readGrowthReport(days), scanInsights()]);
  const scans = insights ? scansInWindow(insights, report.started, report.ended) : null;
  const guidePages = report.traffic?.pages.filter((page) => page.path.startsWith("/guides/")).sort((a, b) => b.pageviews - a.pageviews) ?? [];
  const maxViews = Math.max(1, ...(report.traffic?.days.map((row) => row.pageviews) ?? []));
  const clicks = report.traffic?.events.filter((item) => /click|scan_started|checkout_started/i.test(item.name)) ?? [];
  return <main className="site-shell growth-page">
    <SiteNav />
    <header className="growth-header">
      <div><p className="section-kicker">{KICKER}</p><h1>Growth HQ</h1><p>One overview: visitors, public scans and paid checkouts. Details and projections are below.</p></div>
      <div className="growth-actions">
        <Link href="/growth?days=7" aria-current={days === 7 ? "page" : undefined}>7 days</Link>
        <Link href="/growth?days=30" aria-current={days === 30 ? "page" : undefined}>30 days</Link>
        <form action="/growth/logout" method="post"><button type="submit">Log out</button></form>
      </div>
    </header>
    <p className="growth-note">Period: {report.started.slice(0,10)} to {report.ended.slice(0,10)} UTC. Metrics are fetched when you refresh this page, not streamed.</p>
    <nav className="growth-section-nav" aria-label="Dashboard sections"><a href="#growth-overview">Overview</a><a href="#growth-findings">Scan findings</a><a href="#growth-acquisition">Traffic and guides</a><a href="#growth-experiments">Campaigns</a><a href="#growth-projections">Simulator</a><Link href="/stats">Public stats ↗</Link></nav>
    <section id="growth-overview" className="growth-metrics" aria-label="Growth metrics">
      <article><span>Unique visitors</span><strong>{report.traffic ? num(report.traffic.visitors) : "n/a"}</strong><small>Vercel Web Analytics · {days} days</small></article>
      <article><span>Complete public scans</span><strong>{scans !== null ? num(scans) : "n/a"}</strong><small>Saved reports · {days} days · includes rescans</small></article>
      <article><span>Paid checkouts</span><strong>{report.payments ? num(report.payments.paidCheckouts) : "n/a"}</strong><small>DeployDoctor Stripe · {days} days{report.payments?.partial ? " · partial data" : ""}</small></article>
      <article><span>Gross paid checkout value</span><strong>{report.payments ? (report.payments.gross.length ? report.payments.gross.map(row => money(row.currency, row.minorUnits)).join(" + ") : "No sales") : "n/a"}</strong><small>Before refunds, fees and taxes</small></article>
    </section>
    <p className="growth-note">These totals are independent measurements, not an attributed conversion funnel. Private scans, partial scans and example reports are excluded from public scan counts. No attribution is inferred between a visitor, scan or payment.</p>
    <section id="growth-findings" className="growth-card">
      <h2>What the scans actually find</h2>
      {insights ? <><p>{num(insights.scans)} complete public scans across {num(insights.repositories)} distinct repositories over the past {insights.windowDays} days. The rankings always use this 30-day window, independently of the traffic selector.</p><details><summary>Findings by check</summary><FindingStats data={insights} /></details><p className="growth-note">Latest complete scan per repository. Each risk uses the number of repositories where that check ran; these are detected risks, not confirmed failed deployments. Data updated {new Date(insights.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.</p></> : <p>Scan statistics unavailable. n/a is not zero.</p>}
      <Link href="/stats">Open the public statistics page →</Link>
    </section>
    {report.trafficStatus && <p className="growth-warning" role="status">{report.trafficStatus}</p>}
    {report.paymentStatus && <p className="growth-warning" role="status">{report.paymentStatus}</p>}
    <div id="growth-acquisition" className="growth-columns">
      <section className="growth-card">
        <h2>Traffic over time</h2>
        {report.traffic?.days.length ? <div className="growth-bars" aria-label="Daily pageview bars">
          {report.traffic.days.map((day) => <div key={day.day} className="growth-bar" title={day.day + ": " + day.pageviews + " views"}>
            <div style={{ height: (Math.max(3, 100 * day.pageviews / maxViews)) + "%" }} />
          </div>)}
        </div> : <p>No traffic series available.</p>}
        <p className="growth-note">Daily pageviews · UTC · {days} days</p>
      </section>
      <section className="growth-card">
        <h2>Gross paid checkouts</h2>
        {report.payments ? <>
          {report.payments.gross.length ? report.payments.gross.map((row) => <p key={row.currency} className="growth-money">{money(row.currency, row.minorUnits)}</p>) : <p>No paid DeployDoctor Checkout sessions in this period.</p>}
          <p className="growth-note">Paid Checkout amounts only; not net revenue. Excludes refunds, fees, tax adjustments, recurring invoices and payments from other Stripe apps. {report.payments.partial ? "Incomplete: pagination cap was reached." : ""}</p>
        </> : <p>Payments not available.</p>}
      </section>
    </div>
    <section className="growth-card">
      <h2>SEO guides performance</h2>
      <p>Ranked by pageviews, not search impressions or Google ranking. Only paths available in the Web Analytics window appear here.</p>
      {guidePages.length ? <div className="growth-guide-list">{guidePages.map((page) => <div key={page.path} className="growth-guide-row">
        <Link href={page.path}>{page.path.replace("/guides/", "").replaceAll("-", " ")}</Link>
        <span>{num(page.visitors)} visitors · {num(page.pageviews)} views</span>
      </div>)}</div> : <p>No guide traffic recorded in the selected period yet.</p>}
      <p className="growth-note">Google Search Console is needed for search queries, impressions and organic click-through rates; Web Analytics alone cannot provide those.</p>
    </section>
    <details className="growth-card">
      <summary>CTA clicks and events</summary>
      {clicks.length ? <div className="growth-guide-list">{clicks.map((item) => <div key={item.name} className="growth-guide-row"><span>{item.name}</span><strong>{num(item.count)}</strong></div>)}</div> :
        <p>Not measured yet. Custom CTA events must be instrumented and supported by your Vercel plan before this can show real clicks. n/a is not zero.</p>}
      <p className="growth-note">Custom event tracking is plan-dependent. This dashboard never fabricates historic clicks or attributes a Stripe payment to a particular SEO guide without evidence.</p>
    </details>
    <details id="growth-experiments" className="growth-card">
      <summary>Launch Campaign Performance</summary>
      <p>Observed page traffic in the selected {days}-day window. These are DeployDoctor visits, not merchant sales or Google organic clicks.</p>
      {report.traffic ? <ul>{report.traffic.pages.filter(page => page.path === "/launch-readiness" || page.path === "/diagnose" || page.path.startsWith("/guides/")).map(page => <li key={page.path}><Link href={page.path}>{page.path}</Link>: {num(page.visitors)} visitors · {num(page.pageviews)} pageviews</li>)}</ul> : <p>Launch page traffic: n/a. Analytics is unavailable.</p>}
      {report.traffic && !report.traffic.pages.some(page => page.path === "/launch-readiness") && <p>No launch-page row returned in the available analytics window. This does not establish zero visits.</p>}
      <p>Launch CTA clicks and campaign-attributed reports: not measured. Paid checkout totals above are recorded for DeployDoctor only and are not attributed to this campaign.</p>
      <p className="growth-note">Use the existing 7/30-day selector to inspect each window. The simulator below is hypothetical gross revenue, never verified merchant revenue.</p>
    </details>
    <div id="growth-projections"><GrowthCalculator observedVisitors={report.traffic?.visitors ?? null} /></div>
  </main>;
}
