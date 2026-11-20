import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { repoFromPath } from "@/lib/repo-link";
import { cachedRepoSafety } from "@/lib/repo-safety-store";
import { RepoSafetyForm } from "../../repo-safety-form";
import { RepoSafetyResult } from "../../repo-safety-result";

type Params = { params: Promise<{ owner: string; repo: string }> };

async function named({ params }: Params) {
  const { owner, repo } = await params;
  return repoFromPath([owner, repo]);
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const name = await named(props);
  if (!name) return {};
  const title = `Is ${name} safe to run? Malware check | DeployDoctor`;
  const image = `/api/repo-safety-card?repo=${encodeURIComponent(name)}`;
  return {
    title,
    description: `Before you download or run ${name}: a free check of its code for install scripts, hidden commands, password and wallet stealing, webhooks and download lures. Nothing is run.`,
    alternates: { canonical: `/is-this-repo-safe/${name}` },
    openGraph: { title: `Is ${name} safe to run?`, url: `/is-this-repo-safe/${name}`, type: "website", images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: `Is ${name} safe to run?`, images: [image] },
  };
}

/** One repository's page: the stored check if there is one, otherwise a fresh check in the browser. */
export default async function RepoSafetyRepoPage(props: Params) {
  const name = await named(props);
  if (!name) notFound();
  const stored = await cachedRepoSafety(name).catch(() => null);
  return <main className="site-shell"><SiteNav /><article className="guide leak-page">
    <p className="section-kicker"><Link href="/is-this-repo-safe">IS THIS GITHUB REPO SAFE?</Link></p>
    <h1>Is {name} safe to run?</h1>
    <p className="guide-lead">A read of the repository&apos;s code for the tricks malware repos use, before you download or run it. Nothing is run.</p>
    {stored ? <>
      <RepoSafetyResult report={stored} />
      <h2>Check it again</h2>
      <p>Repositories change. Run a new check on the latest commit:</p>
      <RepoSafetyForm initial={name} autorun={false} />
    </> : <RepoSafetyForm initial={name} />}
  </article></main>;
}
