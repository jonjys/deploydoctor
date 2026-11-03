import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { getT } from "@/lib/lang";
import { listRescueWall } from "@/lib/fix-pr/store";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: `${t("fix.wallTitle")} | DeployDoctor`, description: t("fix.wallLead"), alternates: { canonical: "/rescue" } };
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
                  <p><span>{t("fix.wallAfter")}: </span><a href={entry.liveUrl}>{entry.liveUrl}</a></p>
                  <p><a href={entry.prUrl}>Pull request</a></p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </article>
    </main>
  );
}
