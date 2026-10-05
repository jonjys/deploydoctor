import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { guideBySlug, guides } from "@/lib/guides";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return guides.map((guide) => ({ slug: guide.slug }));
}

type GuideProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: GuideProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return { title: "Guide not found | DeployDoctor" };
  return {
    title: `${guide.title} | DeployDoctor`,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: { type: "article", siteName: "DeployDoctor", url: `/guides/${guide.slug}`, title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({ params }: GuideProps) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();
  const schema = {
    "@context": "https://schema.org", "@type": "TechArticle", headline: guide.title, description: guide.description,
    dateModified: guide.updated, url: `${SITE_URL}/guides/${guide.slug}`,
    author: { "@type": "Organization", name: "DeployDoctor" }, publisher: { "@type": "Organization", name: "Nytto Labs" },
  };
  const others = guides.filter((other) => other.slug !== guide.slug).slice(0, 3);
  return (
    <main className="site-shell">
      <SiteNav current="guides" />
      <article className="guide">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
        <p className="section-kicker"><Link href="/guides">GUIDES</Link> · {guide.check.toUpperCase()}</p>
        <h1>{guide.title}</h1>
        <p className="guide-lead">{guide.description}</p>
        {guide.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
            {section.code && <pre><code>{section.code}</code></pre>}
          </section>
        ))}
        <aside className="guide-cta">
          <div>
            <h2>Check your repository for this before you push</h2>
            <p>DeployDoctor reads a GitHub repository through the API, runs the check this guide covers plus eight more, and names the file. Free for public repositories, nothing is cloned or executed.</p>
          </div>
          <Link className="cta-button" href="/">Scan a repository →</Link>
        </aside>
        <p className="guide-updated">Updated {guide.updated}</p>
        <nav className="guide-more" aria-label="More guides">
          <strong>More guides</strong>
          <ul>{others.map((other) => <li key={other.slug}><Link href={`/guides/${other.slug}`}>{other.title}</Link></li>)}</ul>
        </nav>
      </article>
    </main>
  );
}
