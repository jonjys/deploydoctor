import Link from "next/link";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import type { MessageKey } from "@/lib/i18n";

/**
 * The 24-hour pass offer shown under the findings of a free scan, so the next step is visible after the scan.
 * It reuses the home page copy and the existing checkout button; the price and terms live in one place.
 */
export function ScanPassCta({ t, repoUrl }: { t: (key: MessageKey) => string; repoUrl?: string }) {
  return (
    <section className="pass-strip report-pass-cta" aria-labelledby="report-pass-heading">
      <div>
        <h2 id="report-pass-heading">{t("home.pass.h2")}</h2>
        <p>{t("home.pass.copy")}</p>
      </div>
      <div className="pass-actions">
        <ScanCheckoutButton plan="day" context={repoUrl}>{t("home.pass.cta")}</ScanCheckoutButton>
        <Link href="/pricing">{t("home.pass.more")}</Link>
      </div>
    </section>
  );
}
