import Link from "next/link";
import { getT } from "@/lib/lang";

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
