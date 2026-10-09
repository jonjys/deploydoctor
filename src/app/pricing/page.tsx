import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { planPrice } from "@/lib/plans";
import { getT } from "@/lib/lang";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pricing.title") };
}
export default async function Pricing() {
  const { t, lang } = await getT();
  return <main className="site-shell"><SiteNav current="pricing" /><header className="pricing-header">
    <p className="section-kicker">{t("pricing.kicker")}</p>
    <h1>{t("pricing.h1a")}<br />{t("pricing.h1b")}</h1>
    <p>{t("pricing.sub")}</p>
  </header><section className="pricing-grid" aria-label={t("pricing.plans")}>
    <article className="price-card"><span className="plan-badge">{t("pricing.startHere")}</span><h2>{t("pricing.free")}</h2>
      <p className="price">$0</p><p>{t("pricing.freeScans")}</p><ul><li>{t("pricing.free1")}</li><li>{t("pricing.free2")}</li><li>{t("pricing.free3")}</li><li>{t("pricing.free4")}</li></ul><Link className="cta-button" href="/">{t("pricing.scanFree")}</Link></article>
    {(["day", "week", "public"] as const).map((key) => <article className={`price-card ${key === "week" ? "featured" : ""}`} key={key}>
      <span className="plan-badge">{t(`pricing.badge.${key}`)}</span>
      <h2>{t(`plan.${key}.name`)}</h2><p className="price">{planPrice(key, lang)}<small>{t(`plan.${key}.cadence`)}</small></p>
      <ul><li>{t("pricing.unlimited")}</li><li>{t("pricing.shareable")}</li>{key !== "week" && key !== "day" && <li>{t("pricing.history")}</li>}
        <li>{t("pricing.privateRepos")}</li><li className="plan-note">{t("pricing.privateToken")}</li><li className="plan-note">{t("pricing.privateSession")}</li>
        <li>{t("pricing.ci")}</li>
        {key === "week" && <li>{t("pricing.expires")}</li>}{key === "day" && <li>{t("pricing.expiresDay")}</li>}
        {key !== "week" && key !== "day" && <li>{t("pricing.cancel")}</li>}</ul>
      <ScanCheckoutButton plan={key}>{key === "day" ? t("pricing.cta.day") : key === "week" ? t("pricing.cta.week") : t("pricing.cta.choose")} →</ScanCheckoutButton>
    </article>)}
  </section><section className="pricing-notes"><h2>{t("pricing.notesTitle")}</h2>
    <p>{t("pricing.note2")}</p>
    <p>{t("pricing.note3")}</p>
  </section></main>;
}
