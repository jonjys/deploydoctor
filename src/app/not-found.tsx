import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/lang";
import { notFoundMeta, pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getT();
  return pageMetadata({ ...notFoundMeta[lang], path: "/", canonical: false, robots: { index: false, follow: false } });
}

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="site-shell">
      <div className="not-found-card">
        <p className="section-kicker">{t("nf.kicker")}</p>
        <h1>{t("nf.title")}</h1>
        <p>{t("nf.body")}</p>
        <Link className="cta-button" href="/">
          {t("nf.cta")}
        </Link>
      </div>
    </main>
  );
}
