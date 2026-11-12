import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { DiagnoseForm } from "@/components/diagnose-form";
import { activePlan, customerSession } from "@/lib/access";
import { fixPullRequestsEnabled } from "@/lib/fix-pr/github-app";
import { getT } from "@/lib/lang";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return pageMetadata({ title: t("diag.title"), description: t("diag.meta"), path: "/diagnose" });
}

export default async function DiagnosePage() {
  const { t } = await getT();
  // Someone with a pass already has no cap, so the result never asks them to buy one. A database hiccup only shows the offer.
  const plan = await activePlan(await customerSession()).catch(() => null);
  return (
    <main className="site-shell">
      <SiteNav current="diagnose" />
      <article className="guide diag-page">
        <p className="section-kicker">{t("diag.kicker")}</p>
        <h1>{t("diag.h1")}</h1>
        <p className="guide-lead">{t(fixPullRequestsEnabled() ? "diag.sub" : "diag.leadOff")}</p>
        <DiagnoseForm hasPass={Boolean(plan)} />
      </article>
    </main>
  );
}
