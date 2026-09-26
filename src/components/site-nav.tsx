import Link from "next/link";
import { LangSwitch } from "@/components/lang";
import { getT } from "@/lib/lang";

export async function SiteNav() {
  const { t } = await getT();
  return <nav className="topbar" aria-label="Primary navigation"><Link className="brand" href="/">✚ DeployDoctor</Link>
    <div className="nav-links"><Link href="/pricing">{t("nav.pricing")}</Link><Link href="/account">{t("nav.myScans")}</Link><LangSwitch /></div></nav>;
}
