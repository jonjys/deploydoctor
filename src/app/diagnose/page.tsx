import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { DiagnoseForm } from "@/components/diagnose-form";
import { getT } from "@/lib/lang";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t("diag.title"),
    description: t("diag.sub"),
    alternates: { canonical: "/diagnose" },
    openGraph: { siteName: "DeployDoctor", url: "/diagnose", title: t("diag.title"), description: t("diag.sub") },
  };
}

export default async function DiagnosePage() {
  const { t } = await getT();
  return (
    <main className="site-shell">
      <SiteNav current="diagnose" />
      <article className="guide diag-page">
        <p className="section-kicker">{t("diag.kicker")}</p>
        <h1>{t("diag.h1")}</h1>
        <p className="guide-lead">{t("diag.sub")}</p>
        <DiagnoseForm />
      </article>
    </main>
  );
}
