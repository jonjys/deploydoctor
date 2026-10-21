import { cookies } from "next/headers";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { GrowthCalculator } from "@/components/growth-calculator";
import { GROWTH_COOKIE, usableGrowthPassword, verifyGrowthSession } from "@/lib/growth-auth";
import { readGrowthReport } from "@/lib/growth-data";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private Growth HQ | DeployDoctor",
  robots: { index: false, follow: false, noarchive: true },
};

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
  const cookie = (await cookies()).get(GROWTH_COOKIE)?.value;
  const authorized = verifyGrowthSession(cookie, password);
  if (!authorized) return <main className="site-shell">
    <SiteNav />
    <section className="growth-entrance">
      <p className="section-kicker">PRIVATE • NYTTOLABS</p>
      <h1>Growth HQ</h1>
      {!configured ? <p>This owner-only analytics dashboard is not configured. Add a strong (at least 24 characters) GROWTH_DASHBOARD_PASSWORD environment variable to Vercel Production, then redeploy.</p> : <>
        <p>Owner-only traffic, sales and SEO measurements. This page is not visible to ordinary customers.</p>
        <form action="/growth/session" method="post" className="growth-login">
          <label htmlFor="growth-password">Dashboard password</label>
          <input id="growth-password" name="password" type="password" minLength={24} required autoComplete="current-password" />
          <button className="cta-button" type="submit">Unlock dashboard →</button>
          {params.error === "1" && <p role="alert">Incorrect password.</p>}
        </form>
      </>}
    </section>
  </main>;
  const days = params.days === "7" ? 7 : 30;
  const report = await readGrowthReport(days);
  const guidePages = report.traffic?.pages.filter((page) => page.path.startsWith("/guides/")).sort((a, b) => b.pageviews - a.pageviews) ?? [];
  const maxViews = Math.max(1, ...report.traffic?.days.map((row) => row.pageviews) ?? [1]);
  const clicks = report.traffic?.events.filter((item) => /click|scan_started|checkout_started/i.test(item.name)) ?? [];
  return <main className="site-shell growth-page">
    <SiteNav />
    <header className="growth-header">
      <div><p className="section-kicker">PRIVATE • DEPLOYDOCTOR</p><h1>Growth HQ</h1><p>Traffic, SEO discovery, checkout sales and a what-if revenue simulator.</p></div>
      <div className="growth-actions">
        <Link href="/growth?days=7" aria-current={days === 7 ? "page" : undefined}>7 days</Link>
        <Link href="/growth?days=30" aria-current={days === 30 ? "page" : undefined}>30 days</Link>
        <form action="/growth/logout" method="post"><button type="submit">Log out</button></form>
      </div>
    </header>
    <p className="growth-note">Period: {report.started.slice(0,10)} to {report.ended.slice(0,10)} UTC. Metrics are fetched when you refresh this page, not streamed.</p>
    <section className="growth-metrics" aria-label="Growth metrics">
      <article><span>Unique visitors</span><strong>{report.traffic ? num(report.traffic.visitors) : "—"}</strong><small>Vercel Web Analytics</small></article>
      <article><span>Pageviews</span><strong>{report.traffic ? num(report.traffic.pageviews) : "—"}</strong><small>All routes</small></article>
      <article><span>Paid checkouts</span><strong>{report.payments ? num(report.payments.paidCheckouts) : "—"}</strong><small>Stripe Checkout sessions</small></article>
      <article><span>Checkout / visitor ratio</span><strong>{report.traffic && report.payments && report.traffic.visitors > 0 ? (100 * report.payments.paidCheckouts / report.traffic.visitors).toFixed(1) + "%" : "—"}</strong><small>Not a user-attributed conversion rate</small></article>
    </section>
    {report.trafficStatus && <p className="growth-warning" role="status">{report.trafficStatus}</p>}
    {report.paymentStatus && <p className="growth-warning" role="status">{report.paymentStatus}</p>}
    <div className="growth-columns">
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
    <section className="growth-card">
      <h2>CTA clicks and events</h2>
      {clicks.length ? <div className="growth-guide-list">{clicks.map((item) => <div key={item.name} className="growth-guide-row"><span>{item.name}</span><strong>{num(item.count)}</strong></div>)}</div> :
        <p>Not measured yet. Custom CTA events must be instrumented and supported by your Vercel plan before this can show real clicks. A dash is not zero.</p>}
      <p className="growth-note">Custom event tracking is plan-dependent. This dashboard never fabricates historic clicks or attributes a Stripe payment to a particular SEO guide without evidence.</p>
    </section>
    <GrowthCalculator observedVisitors={report.traffic?.visitors ?? null} />
  </main>;
}
