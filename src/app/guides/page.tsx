import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { guides } from "@/lib/guides";

export const metadata: Metadata = {
  title: "Vercel deployment troubleshooting guides | DeployDoctor",
  description: "Fix Vercel deployment issues with practical guides for Next.js, Vite, SvelteKit, pnpm, Supabase, build configuration and runtime errors.",
  alternates: { canonical: "/guides" },
};

export default function GuidesIndex() {
  return (
    <main className="site-shell">
      <SiteNav current="guides" />
      <header className="pricing-header">
        <p className="section-kicker">GUIDES</p>
        <h1>Why it works locally<br />and fails on Vercel.</h1>
        <p>One page per failure class, with the fix. Every guide ends with a scan, and your first one each day is free for public repositories.</p>
      </header>
      <ul className="guide-list">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guides/${guide.slug}`}>
              <strong>{guide.title}</strong>
              <span>{guide.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
