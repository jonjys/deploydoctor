import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SafeForm } from "./safe-form";

export const metadata: Metadata = {
  title: "Is my app safe? Check your live app in 30 seconds | DeployDoctor",
  description: "Paste your live app. DeployDoctor checks for secret keys in your JavaScript, Supabase tables anyone can read, public .env and .git files, source maps and browser protection headers. Built for apps made with Lovable, Bolt, v0, Cursor and Claude Code.",
  alternates: { canonical: "/safe" },
  openGraph: { title: "Is my app safe?", description: "Leaked keys, open Supabase tables, public .env files. One answer for your live app.", url: "/safe", type: "website" },
};

export default function SafePage() {
  return <main className="site-shell"><SiteNav current="safe" /><article className="guide leak-page">
    <p className="section-kicker">IS MY APP SAFE?</p>
    <h1>Is my app safe?</h1>
    <p className="guide-lead">One answer for your live app: secret keys in the JavaScript, Supabase tables anyone can read, public <code>.env</code> and <code>.git</code> files, source maps, and browser protection. Made for apps built with Lovable, Bolt, v0, Cursor and Claude Code.</p>
    <SafeForm />
    <h2>What it checks</h2>
    <ul>
      <li><strong>Secret keys</strong> in the JavaScript every visitor downloads: Stripe, Supabase service_role, OpenAI, Anthropic, AWS, GitHub.</li>
      <li><strong>Your database</strong>: which Supabase tables the public key in your site can read without signing in. Missing Row Level Security is the most common way AI-built apps leak user data.</li>
      <li><strong>Source files</strong>: public <code>.env</code>, <code>.git</code> and source maps.</li>
      <li><strong>Browser protection</strong>: HTTPS enforcement, framing protection, Content Security Policy.</li>
    </ul>
    <h2>Why the owner has to verify</h2>
    <p>Anyone may run the public checks, because they read only what a browser downloads. Testing a database or asking for <code>.env</code> is what an attacker does, so those checks run only after you prove the site is yours with a file or a meta tag. The database test sends HEAD requests that return a row count. It never reads, writes or stores a row.</p>
    <p>Want the code side too? <Link href="/#scan-repository">Scan the repo</Link> for the file and line, or read <Link href="/launch-manual">the launch manual</Link>.</p>
  </article></main>;
}
