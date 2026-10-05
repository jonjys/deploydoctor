import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { guides } from "@/lib/guides";

export const metadata: Metadata = {
  title: "Guides: why Next.js apps fail on Vercel | DeployDoctor",
  description: "Short, accurate guides for the deploy failures DeployDoctor checks: env variables, case sensitive imports, Edge runtime errors, lockfile drift and Prisma on Vercel.",
  alternates: { canonical: "/guides" },
};

export default function GuidesIndex() {
  return (
    <main className="site-shell">
      <SiteNav current="guides" />
      <header className="pricing-header">
        <p className="section-kicker">GUIDES</p>
        <h1>Why it works locally<br />and fails on Vercel.</h1>
        <p>One page per failure class, with the fix. Every guide ends with a scan, which is free for public repositories.</p>
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
