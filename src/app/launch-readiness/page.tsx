import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { PRODUCTION_RULES } from "@/lib/production-rules";

export const metadata = {
  title: "Black Friday deployment checklist | Launch Readiness | DeployDoctor",
  description: "Check your GitHub repository for Vercel build, Stripe webhook and production configuration risks before launch. Static preflight with source evidence and next steps.",
  alternates: { canonical: "/launch-readiness" },
  openGraph: { title: "Check your deployment before the traffic arrives", description: "Source-backed build, payment integration and production configuration risks. Static preflight, with clear limits.", url: "/launch-readiness", type: "website" },
  twitter: { card: "summary_large_image", title: "Check your deployment before the traffic arrives", description: "Source-backed deployment risks, evidence and next steps before launch." },
};
export default function LaunchPage() {
  return <main className="site-shell">
    <SiteNav />
    <section className="hero">
      <p className="section-kicker">LAUNCH READINESS · BLACK FRIDAY AND BEYOND</p>
      <h1>Check your deployment before the traffic arrives.</h1>
      <p className="hero-copy">Launching a Black Friday campaign, a product or a major release? Find common Vercel build, payment integration and configuration risks in your GitHub repository before you send customers there.</p>
      <div className="action-buttons"><Link className="cta-button" href="/#scan-repository">Scan your GitHub repo →</Link><Link href="/#checks-heading">See what DeployDoctor checks</Link></div>
    </section>
    <section className="launch-readiness"><h2>Source evidence. A clear next step.</h2><p>Your existing DeployDoctor report now includes critical blockers, items to review and a manual launch checklist. See the affected file and line, then use the detailed fixes. Eligible import fixes can use the existing paid, verified patch and draft PR flow.</p><h3>New production safety rules</h3><ul>{PRODUCTION_RULES.map(rule => <li key={rule}>{rule.replaceAll("-", " ")}</li>)}</ul></section>
    <section className="launch-readiness"><h2>A preflight, with clear limits</h2><p>Static analysis only. We do not run your repository, test checkout, check inventory, confirm production environment values or load-test your site. Manual build, runtime and signed payment-webhook tests remain necessary.</p><p>Black Friday is November 27, 2026. The same checklist helps with every important deployment.</p><p>Existing free allowance and paid passes apply. No new subscription is required. Watch this repo remains optional and only sends alerts after you opt in.</p><Link href="/pricing">Existing pricing →</Link>{" · "}<Link href="/guides">Deployment guides →</Link></section>
  </main>;
}
