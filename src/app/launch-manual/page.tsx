import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { pageMetadata, pages } from "@/lib/seo";

export const metadata = pageMetadata(pages.launch);

const STEPS: Array<{ title: string; why: string; items: string[] }> = [
  { title: "Make the deploy pass", why: "Nothing else matters until Vercel builds it.", items: [
    "Import paths must match file names letter for letter: your Mac forgives a wrong capital letter, Vercel's Linux build does not.",
    "Every package you import must be in package.json, with one lockfile committed.",
    "Run npm run build once on your machine before you push. If it fails there, it fails on Vercel." ] },
  { title: "Set every environment variable in Vercel", why: "Your .env.local never leaves your laptop. A missing variable breaks that feature only after launch.", items: [
    "Add each variable your code reads under Settings, then Environment Variables, for Production.",
    "NEXT_PUBLIC_ variables are visible to everyone in the browser. Never put a secret key in one.",
    "Redeploy after adding variables: Vercel only reads them on the next deployment." ] },
  { title: "Take real payments", why: "Test mode is money that never arrives.", items: [
    "Activate your Stripe account early: payouts need business and bank details.",
    "Swap to live keys in Vercel and create a live webhook endpoint for your production URL, with its own signing secret.",
    "Buy your own product once with a real card, then refund yourself. Send the same webhook twice and check nothing is delivered twice." ] },
  { title: "Protect your data", why: "Leaked tables are the most common way vibe-coded apps end up in the news.", items: [
    "Supabase: enable Row Level Security on every table with user data, with a policy for who can read and write.",
    "The service role key stays on the server. Never NEXT_PUBLIC_, never in a 'use client' file.",
    "Turn on backups and restore one once so you know how." ] },
  { title: "Make sign-in work on the real domain", why: "OAuth that works on localhost fails in production because of callback URLs.", items: [
    "Add https://your-domain and its callback URL in your auth provider and in Google or GitHub OAuth settings.",
    "Set Supabase's Site URL and Redirect URLs to your domain, or email links still point to localhost.",
    "Sign up as a brand-new user in a private window on the live site." ] },
  { title: "Legal and trust", why: "Missing pages cost sales and can get a payment account paused.", items: [
    "A privacy policy that names the services that process data: hosting, database, payments, analytics.",
    "Terms of service with your refund policy.",
    "A support email on the site and in Stripe's public details." ] },
  { title: "Know when it breaks", why: "On launch day you are the only support team.", items: [
    "Error monitoring (Sentry or Vercel's logs and alerts).",
    "Analytics (Vercel Web Analytics or Plausible), so you see whether launch traffic arrives.",
    "A check on every pull request, so the next change does not break production." ] },
  { title: "Polish before you share it", why: "First impressions come from the link preview and the error pages.", items: [
    "A share image, so your link does not unfurl as plain text on X and LinkedIn.",
    "A custom 404 and an error page instead of the default crash screen.",
    "A sitemap and security headers." ] },
  { title: "Launch day", why: "Where and how to post so people try it.", items: [
    "One focused post per day: X with a 30-second screen recording, Reddit (r/SideProject and your users' own subreddit), Indie Hackers, Product Hunt.",
    "Show HN needs an account that has commented for a while. Lead with the problem, not the stack.",
    "Reply to every sign-up personally and ask what they expected." ] },
];

export default function LaunchManualPage() {
  return <main className="site-shell"><SiteNav /><article className="guide">
    <p className="section-kicker">THE VIBE CODER&apos;S LAUNCH MANUAL</p>
    <h1>It works on your machine. Now get your first paying customer.</h1>
    <p className="guide-lead">You built it with Cursor, Lovable, Bolt, v0 or Claude Code. These are the nine steps between a working prototype and a product people can pay for, in the order they bite.</p>
    <p><Link href="/#scan-repository" className="cta-button">Get this plan for your own repo →</Link></p>
    <p>DeployDoctor scans your GitHub repository and turns this manual into your plan: the exact environment variable names your code reads, your Stripe webhook URL, the pages you are missing, and one prompt your AI editor can run to do the code changes.</p>
    {STEPS.map((step, index) => <section key={step.title}>
      <h2>{index + 1}. {step.title}</h2>
      <p><em>{step.why}</em></p>
      <ul>{step.items.map(item => <li key={item}>{item}</li>)}</ul>
    </section>)}
    <h2>Your version, from your code</h2>
    <p>Paste your GitHub repository into DeployDoctor. The scan is free, nothing is installed or run, and the report shows the first part of your launch plan. The full plan, the AI prompt and a downloadable checklist come with the 24-hour pass for $2.</p>
    <p><Link href="/#scan-repository" className="cta-button">Scan my repo →</Link>{" "}<Link href="/pricing">Pricing →</Link></p>
  </article></main>;
}
