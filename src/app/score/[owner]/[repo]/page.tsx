import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { CopyTextButton } from "@/components/copy-text-button";
import { latestPublicRepoReport } from "@/lib/repo-status-store";
import { liveBadgeMarkdown, repoStatus, statusRepository } from "@/lib/repo-status";
import { SITE_URL } from "@/lib/site";
import { getLang } from "@/lib/lang";

type Props = { params: Promise<{ owner: string; repo: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  if (!statusRepository(owner, repo)) return { title: "Repository status" };
  return { title: `${owner}/${repo}: latest scan | DeployDoctor`, description: "Latest public scan, checked commit and findings. Static checks do not guarantee a successful deployment.",
    alternates: { canonical: `/score/${owner}/${repo}` }, robots: { index: false, follow: true } };
}

export default async function RepoScore({ params }: Props) {
  const { owner, repo } = await params;
  if (!statusRepository(owner, repo)) notFound();
  const sv = await getLang() === "sv";
  const loaded = await latestPublicRepoReport(owner.toLowerCase(), repo.toLowerCase()).then(report => ({ report, unavailable: false }), () => ({ report: null, unavailable: true }));
  const { report, unavailable } = loaded;
  const status = repoStatus(report);
  const repoName = `${owner}/${repo}`;
  const snippet = liveBadgeMarkdown(owner, repo, SITE_URL);
  return <main className="site-shell"><SiteNav /><article className="guide repo-score">
    <p className="section-kicker">{sv ? "SENASTE PUBLIKA SKANNINGEN" : "LATEST PUBLIC SCAN"}</p>
    <h1>{repoName}</h1>
    <p className="guide-lead">{sv ? "En fast länk till senaste skanningen av repots standardgren." : "One permanent link to the latest scan of this repository’s default branch."}</p>
    {unavailable ? <p role="alert">{sv ? "Status kan inte hämtas just nu. Försök igen senare." : "Status is unavailable right now. Please try again later."}</p> : report ? <>
      <p><strong>{status.label}</strong>{status.stale && <> · {sv ? "Skanna igen för aktuell status" : "Rescan for a current result"}</>}</p>
      <p><time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString(sv ? "sv-SE" : "en-US", { timeZone: "UTC" })} UTC</time>{status.commit && <> · <a href={`${report.repo_url}/commit/${report.results.repository.commitSha}`}>Commit {status.commit}</a></>}</p>
      <ul className="repo-check-list">{report.results.checks.map(check => <li key={check.id}><span aria-label={check.status}>{check.status === "red" ? "×" : check.status === "yellow" ? "!" : "✓"}</span> {check.title}<Link href={`/r/${report.id}#check-${check.id}`}>{sv ? "Visa fynd" : "View findings"} →</Link></li>)}</ul>
      <p><Link className="cta-button" href={`/r/${report.id}`}>{sv ? "Öppna rapport och föreslagna fixar" : "Open report and suggested fixes"} →</Link></p>
      <section className="badge-section"><h2>{sv ? "Aktuell status i din README" : "Keep your README up to date"}</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/badge/${owner}/${repo}.svg`} alt={`DeployDoctor: ${status.label}, ${status.date}, ${status.commit}`} height={20} />
        <pre><code>{snippet}</code></pre><CopyTextButton text={snippet} label={sv ? "Kopiera markdown" : "Copy markdown"} copiedLabel={sv ? "Kopierat" : "Copied"} />
      </section>
    </> : <p>{sv ? "Ingen publik skanning finns ännu. Privata rapporter visas aldrig här." : "No public scan yet. Private reports never appear here."}</p>}
    <p>{sv ? "Status gäller den visade committen. Koden kan ha ändrats sedan dess. Begränsade och äldre skanningar markeras; en grön badge garanterar inte att en deploy lyckas." : "Status applies to the commit shown. The code may have changed since. Partial scans and scans older than seven days are marked; a green badge does not guarantee a successful deployment."}</p>
    <p><Link className="copy-button" href={`/?repo=${encodeURIComponent(repoName)}`}>{sv ? "Skanna repot igen" : "Scan this repository"} →</Link> <Link href="/diagnose">{sv ? "Har bygget redan misslyckats?" : "Build already failed?"}</Link></p>
    <p><small>{sv ? "Uppdateras från sparade rapporter med cirka en minuts cache. Sidvisningar och badges startar inga skanningar." : "Updated from saved reports with about one minute of caching. Page and badge views never start a scan."}</small></p>
  </article></main>;
}
