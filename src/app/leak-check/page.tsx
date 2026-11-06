import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LeakCheckForm } from "./leak-check-form";

export const metadata: Metadata = {
  title: "Leak check: is your API key in your live JavaScript? | DeployDoctor",
  description: "Paste your live site. DeployDoctor reads the JavaScript every visitor downloads and finds Stripe, Supabase service_role, OpenAI and Anthropic keys baked in by NEXT_PUBLIC_ or VITE_ variables. GitHub secret scanning cannot see these.",
  alternates: { canonical: "/leak-check" },
  openGraph: { title: "Is your API key in your live JavaScript?", description: "The leak GitHub secret scanning cannot see. Free check, values masked, nothing saved.", url: "/leak-check", type: "website" },
};

export default function LeakCheckPage() {
  return <main className="site-shell"><SiteNav /><article className="guide leak-page">
    <p className="section-kicker">LIVE LEAK CHECK</p>
    <h1>Is your API key in your live JavaScript?</h1>
    <p className="guide-lead">A key in a <code>NEXT_PUBLIC_</code> or <code>VITE_</code> variable is written into your site when it builds. It never appears in your repo, so GitHub secret scanning and repo scanners cannot see it, but every visitor downloads it. Paste your live site to check.</p>
    <LeakCheckForm />
    <h2>What it looks for</h2>
    <ul>
      <li>Stripe live and test secret keys, restricted keys and webhook secrets</li>
      <li>Supabase <code>service_role</code> keys and new secret keys, which bypass Row Level Security</li>
      <li>OpenAI and Anthropic API keys, the ones bots scrape and spend</li>
      <li>AWS access keys, GitHub tokens and private keys</li>
    </ul>
    <p>Public keys such as Stripe <code>pk_live_</code> and the Supabase anon key are listed as fine: they are meant to be in the browser.</p>
    <h2>How it works</h2>
    <p>DeployDoctor fetches your page over https and the JavaScript files on the same site, the same files a browser loads. It does not log in, click, submit forms or call your APIs. Found values are masked to their type and last four characters, and nothing about the site is saved.</p>
    <p>Want the rest too? The <Link href="/site-check">live site check</Link> runs this leak check plus privacy, terms, returns and contact pages, your VAT number in VIES, and whether AI search can read you.</p>
    <p>Building the next launch? <Link href="/launch-manual">The vibe coder&apos;s launch manual</Link> covers environment variables, Stripe live mode and Supabase RLS step by step.</p>
  </article></main>;
}
