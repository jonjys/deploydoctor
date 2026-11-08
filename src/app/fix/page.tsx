import type { Metadata } from "next";
import { FixForm } from "@/components/fix-form";
import { SiteNav } from "@/components/site-nav";
import { fixPullRequestsEnabled } from "@/lib/fix-pr/github-app";
import { getT } from "@/lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const purchases = fixPullRequestsEnabled();
  return { title: t("fix.title"), description: t(purchases ? "fix.sub" : "fix.leadOff"), alternates: { canonical: "/fix" } };
}

export default async function FixPage({ searchParams }: { searchParams: Promise<{ repo?: string; github?: string }> }) {
  const { t } = await getT();
  const purchases = fixPullRequestsEnabled();
  const query = await searchParams;
  const initial = typeof query.repo === "string" ? query.repo.slice(0, 300) : "";
  const github = query.github === "connected" || query.github === "failed" || query.github === "cancelled" ? query.github : null;
  return (
    <main className="site-shell">
      <SiteNav current="fix" />
      <article className="guide diag-page">
        <p className="section-kicker">{t("fix.kicker")}</p>
        <h1>{t("fix.h1")}</h1>
        <p className="guide-lead">{t(purchases ? "fix.sub" : "fix.leadOff")}</p>
        <FixForm initialTarget={initial} github={github} purchasesEnabled={purchases} />
      </article>
    </main>
  );
}
