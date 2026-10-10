import Link from "next/link";
import type { ReactNode } from "react";
import { LangSwitch } from "@/components/lang";
import { getT } from "@/lib/lang";

export type NavPage = "scan" | "diagnose" | "pricing" | "guides" | "ci" | "account";

export function PulseMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

/** The one navigation bar for every page: brand, Scan, Pricing, My scans, language. `note` is the report status. */
export async function SiteNav({ current, note }: { current?: NavPage; note?: ReactNode } = {}) {
  const { t } = await getT();
  const active = (page: NavPage) => (current === page ? { "aria-current": "page" as const } : {});
  return (
    <nav className="topbar" aria-label="Primary navigation">
      <Link className="brand" href="/" aria-label="DeployDoctor home">
        <PulseMark />
        <span className="brand-name">DeployDoctor</span>
      </Link>
      {note ? <span className="nav-note">{note}</span> : null}
      <div className="nav-links">
        <Link href="/" {...active("scan")}>{t("nav.scan")}</Link>
        <Link href="/diagnose" {...active("diagnose")}>{t("nav.diagnose")}</Link>
        <Link href="/pricing" {...active("pricing")}>{t("nav.pricing")}</Link>
        <Link href="/guides" {...active("guides")}>{t("nav.guides")}</Link>
        <Link href="/ci" {...active("ci")}>{t("nav.ci")}</Link>
        <Link href="/ai-plugin">AI plugin</Link>
        <Link href="/account" {...active("account")}>{t("nav.myScans")}</Link>
        <LangSwitch />
      </div>
    </nav>
  );
}
