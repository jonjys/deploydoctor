import Link from "next/link";
import type { ReactNode } from "react";
import { LangSwitch } from "@/components/lang";
import { getT } from "@/lib/lang";
import styles from "./site-nav.module.css";

export type NavPage = "safe" | "scan" | "diagnose" | "fix" | "rescue" | "pricing" | "guides" | "ci" | "account" | "stats";

export function PulseMark() {
  return <span className="logo-mark" aria-hidden="true"><span /><span /></span>;
}

/** Four core destinations. Everything else remains available under More, including on mobile. */
export async function SiteNav({ current, note }: { current?: NavPage; note?: ReactNode } = {}) {
  const { lang, t } = await getT();
  const primary = [
    { href: "/", label: t("nav.scan"), page: "scan" },
    { href: "/safe", label: lang === "sv" ? "Kolla min app" : "Check my app", page: "safe" },
    { href: "/fix", label: lang === "sv" ? "Fixa en build" : "Fix a build", page: "fix" },
    { href: "/pricing", label: t("nav.pricing"), page: "pricing" },
  ];
  const secondary = [
    { href: "/account", label: t("nav.myScans") },
    { href: "/site-check", label: lang === "sv" ? "Site Check och köparberedskap" : "Site Check and launch trust" },
    { href: "/diagnose", label: t("nav.diagnose") },
    { href: "/guides", label: t("nav.guides") },
    { href: "/ci", label: "GitHub Action" },
    { href: "/ai-plugin", label: "AI / MCP" },
    { href: "/watch", label: "Repo Watch" },
    { href: "/stats", label: t("nav.stats") },
    { href: "/partners", label: lang === "sv" ? "För partners" : "For partners" },
  ];
  const navItems = <>
    {primary.map(item => <Link href={item.href} key={item.href} aria-current={current === item.page ? "page" : undefined}>{item.label}</Link>)}
    <Link href="/account" aria-current={current === "account" ? "page" : undefined}>{t("nav.myScans")}</Link>
  </>;
  const moreItems = <>{secondary.filter(item => item.href !== "/account").map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}</>;
  return <nav className={styles.bar} aria-label={lang === "sv" ? "Huvudnavigation" : "Primary navigation"}>
    <Link className={styles.brand} href="/" aria-label="DeployDoctor home"><PulseMark /><span>DeployDoctor</span></Link>
    <div className={styles.desktop} aria-label="Main destinations">{navItems}
      <details className={styles.more}><summary>{lang === "sv" ? "Mer" : "More"} <span aria-hidden="true">⌄</span></summary><div className={styles.dropdown}>{moreItems}</div></details>
    </div>
    <div className={styles.right}>
      {note && <span className={styles.note}>{note}</span>}
      <LangSwitch />
      <details className={styles.mobile}><summary aria-label={lang === "sv" ? "Öppna meny" : "Open menu"}>{lang === "sv" ? "Meny" : "Menu"} <span aria-hidden="true">☰</span></summary><div className={styles.mobilePanel}>{navItems}<div className={styles.mobileDivider} />{moreItems}</div></details>
    </div>
  </nav>;
}
