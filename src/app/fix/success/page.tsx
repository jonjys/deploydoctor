import type { Metadata } from "next";
import { FixSuccess } from "@/components/fix-success";
import { SiteNav } from "@/components/site-nav";
import { getT } from "@/lib/lang";

export const metadata: Metadata = { title: "Fix pull request | DeployDoctor", robots: { index: false, follow: false } };

export default async function FixSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { t } = await getT();
  const sessionId = (await searchParams).session_id ?? "";
  const valid = /^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId);
  return (
    <main className="site-shell">
      <SiteNav current="fix" />
      <article className="guide diag-page">
        <p className="section-kicker">{t("fix.kicker")}</p>
        <h1>{t("fix.h1")}</h1>
        <p>{t("fix.promise")}</p>
        {valid ? <FixSuccess sessionId={sessionId} /> : <p>Open this page from the link Stripe returns after payment.</p>}
      </article>
    </main>
  );
}
