import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { errorPages } from "@/lib/error-pages";

export const metadata: Metadata = {
  title: "Common Vercel deployment errors and fixes | DeployDoctor",
  description: "One short page per common Vercel deployment error, with the fix from the official Vercel and Next.js documentation and a link to the source.",
  alternates: { canonical: "/errors" },
};

export default function ErrorsIndex() {
  return (
    <main className="site-shell">
      <SiteNav current="guides" />
      <header className="pricing-header">
        <p className="section-kicker">VERCEL ERRORS</p>
        <h1>Common Vercel errors<br />and the documented fix.</h1>
        <p>Each page names the error, lists the steps from the official documentation and links the source. Longer troubleshooting is in the <Link href="/guides">guides</Link>.</p>
      </header>
      <ul className="guide-list">
        {errorPages.map((page) => (
          <li key={page.slug}>
            <Link href={`/errors/${page.slug}`}>
              <strong>{page.title}</strong>
              <span>{page.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
