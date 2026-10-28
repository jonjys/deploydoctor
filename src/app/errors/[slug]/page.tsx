import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { GuideText } from "@/components/guide-text";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { errorPageBySlug, errorPages, otherErrorPages } from "@/lib/error-pages";
import { guideBySlug } from "@/lib/guides";
import { plans } from "@/lib/plans";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return errorPages.map((page) => ({ slug: page.slug }));
}

type ErrorPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ErrorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = errorPageBySlug(slug);
  if (!page) return { title: "Error page not found | DeployDoctor" };
  return {
    title: `${page.title} | DeployDoctor`,
    description: page.description,
    alternates: { canonical: `/errors/${page.slug}` },
    openGraph: { type: "article", siteName: "DeployDoctor", url: `/errors/${page.slug}`, title: page.title, description: page.description },
  };
}

export default async function ErrorReferencePage({ params }: ErrorPageProps) {
  const { slug } = await params;
  const page = errorPageBySlug(slug);
  if (!page) notFound();
  const schema = {
    "@context": "https://schema.org", "@type": "TechArticle", headline: page.title, description: page.description,
    dateModified: page.updated, url: `${SITE_URL}/errors/${page.slug}`, citation: page.docs.map((doc) => doc.url),
    author: { "@type": "Organization", name: "DeployDoctor" }, publisher: { "@type": "Organization", name: "Nytto Labs" },
  };
  const deeper = page.relatedGuides.flatMap((guideSlug) => { const guide = guideBySlug(guideSlug); return guide ? [guide] : []; });
  return (
    <main className="site-shell">
      <SiteNav current="guides" />
      <article className="guide" lang="en">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
        <p className="section-kicker"><Link href="/errors">VERCEL ERRORS</Link></p>
        <h1>{page.title}</h1>
        <p className="guide-lead">{page.description}</p>
        {page.errorText && <pre><code>{page.errorText}</code></pre>}
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body?.map((paragraph) => <p key={paragraph.slice(0, 40)}><GuideText text={paragraph} /></p>)}
            {section.steps && <ol style={{ listStyle: "decimal", paddingLeft: "1.4rem", display: "grid", gap: "0.5rem" }}>{section.steps.map((step) => <li key={step.slice(0, 40)}><GuideText text={step} /></li>)}</ol>}
            {section.code && <pre><code>{section.code}</code></pre>}
          </section>
        ))}
        <section>
          <h2>What a DeployDoctor scan can check</h2>
          <p><GuideText text={page.scanNote} /></p>
        </section>
        <section>
          <h2>Sources</h2>
          <ul>{page.docs.map((doc) => <li key={doc.url}><a href={doc.url} rel="noopener noreferrer">{doc.label}</a></li>)}</ul>
          <p className="guide-updated">Documentation last checked {page.updated}. Vercel can change its documentation; confirm against the linked pages.</p>
        </section>
        <aside className="guide-cta">
          <div>
            <h2>Check the repository before the next push</h2>
            <p>DeployDoctor scans a GitHub repository for common deployment risks and points to the file and line when it finds one. Repository code is not executed, so a scan cannot confirm runtime behavior. One free scan a day on public repositories. The 24-hour pass is {plans.day.usd} one-time and covers unlimited scans of public and private repositories for 24 hours.</p>
          </div>
          <div className="guide-cta-links">
            <ScanCheckoutButton plan="day">Get the 24-hour pass, {plans.day.usd} →</ScanCheckoutButton>
            <Link href="/">Scan a public repository free →</Link>
            <Link href="/diagnose">Build already failed? Paste the log →</Link>
          </div>
        </aside>
        {deeper.length > 0 && (
          <nav className="guide-more" aria-label="Longer guides on this topic">
            <strong>Longer guides on this topic</strong>
            <ul>{deeper.map((guide) => <li key={guide.slug}><Link href={`/guides/${guide.slug}`}>{guide.title}</Link></li>)}</ul>
          </nav>
        )}
        <nav className="guide-more" aria-label="More Vercel error pages">
          <strong>More Vercel errors</strong>
          <ul>{otherErrorPages(page).map((other) => <li key={other.slug}><Link href={`/errors/${other.slug}`}>{other.title}</Link></li>)}</ul>
        </nav>
      </article>
    </main>
  );
}
