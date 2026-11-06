import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteCheckForm } from "./site-check-form";
import { LegalLinks } from "@/components/legal-links";

export const metadata: Metadata = {
  title: "Live site check: leaked keys, EU rules, VAT number, AI search | DeployDoctor",
  description: "Paste your live site. DeployDoctor finds secret keys in the JavaScript every visitor downloads, checks the privacy, terms, returns and contact pages EU buyers expect, verifies your VAT number in VIES and tells you whether ChatGPT, Claude and Perplexity can read you.",
  alternates: { canonical: "/site-check" },
  openGraph: { title: "Is your live site ready for buyers?", description: "Leaked keys, EU rules, VAT number and AI search in one free check. Values masked, nothing saved.", url: "/site-check", type: "website" },
};

export default async function SiteCheckPage() {
  return <main className="site-shell"><SiteNav /><article className="guide leak-page">
    <p className="section-kicker">LIVE SITE CHECK</p>
    <h1>Is your live site ready for buyers?</h1>
    <p className="guide-lead">Your repo can be clean while the deployed site is not. Paste the live address: DeployDoctor reads what every visitor, every buyer and every AI assistant reads, and tells you what to fix before you send traffic there.</p>
    <SiteCheckForm />
    <h2>What it checks</h2>
    <ul>
      <li><strong>Leaked keys.</strong> Stripe, Supabase <code>service_role</code>, OpenAI, Anthropic, AWS and GitHub secrets baked into your public JavaScript by <code>NEXT_PUBLIC_</code> or <code>VITE_</code> variables. <Link href="/leak-check">More about the leak check</Link>.</li>
      <li><strong>Trust and EU rules.</strong> A privacy policy, terms of sale, a returns policy when you sell online, and contact details: linked from the homepage, or at the usual addresses for Shopify and other platforms.</li>
      <li><strong>VAT number.</strong> If your footer shows an EU VAT number, it is checked once, anonymously, in the European Commission&apos;s VIES service.</li>
      <li><strong>Search and AI search.</strong> Whether robots.txt shuts out Google or the crawlers behind ChatGPT, Claude and Perplexity answers (blocking training-only crawlers such as GPTBot is reported as an opt-out, not a problem), and whether the homepage has schema.org structured data in JSON-LD or microdata.</li>
    </ul>
    <h2>How it works</h2>
    <p>DeployDoctor fetches your homepage over https, the JavaScript files on the same site, robots.txt and, for pages the homepage does not link, a few well-known policy addresses one at a time, all on your own host. It does not log in, click, submit forms or call your APIs. Secrets are masked to their type and last four characters, and nothing about the site is saved.</p>
    <p>Limits: pages rendered only by JavaScript in the browser are not run, so a footer built that way is looked for at the usual addresses instead. A VAT number VIES cannot answer for right now is reported as not checked, never as invalid. This is a checklist, not legal advice.</p>
    <p>Email deliverability (SPF, DKIM, DMARC), link previews and Google basics are checked by our sister tool <a href="https://sellscore.nyttolabs.com">SellScore</a>. The repository behind the site: <Link href="/#scan-repository">scan it here</Link>.</p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
