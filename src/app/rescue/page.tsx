import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { getT } from "@/lib/lang";
import { pageMetadata } from "@/lib/seo";
import { listRescueWall } from "@/lib/fix-pr/store";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return pageMetadata({ title: t("fix.wallSeoTitle"), description: t("fix.wallMeta"), path: "/rescue" });
}

export default async function RescuePage() {
  const { t } = await getT();
  const entries = await listRescueWall();
  return (
    <main className="site-shell">
      <SiteNav current="rescue" />
      <article className="guide">
        <p className="section-kicker">{t("fix.kicker")}</p>
        <h1>{t("fix.wallTitle")}</h1>
        <p className="guide-lead">{t("fix.wallLead")}</p>
        {entries.length === 0 ? <p>{t("fix.wallEmpty")}</p> : (
          <ol className="check-list">
            {entries.map((entry) => (
              <li key={entry.prUrl}>
                <div>
                  <strong>{entry.repo.replace("https://github.com/", "")}</strong>
                  <p><span>{t("fix.wallBefore")}: </span>{entry.error}</p>
                  <p><span>{t("fix.wallAfter")}: </span><a href={entry.liveUrl} rel="nofollow ugc noopener noreferrer" target="_blank">{entry.liveUrl}</a></p>
                  <p><a href={entry.prUrl} rel="nofollow noopener noreferrer" target="_blank">Pull request</a></p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </article>
    </main>
  );
}
