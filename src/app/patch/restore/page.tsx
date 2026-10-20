import { SiteNav } from "@/components/site-nav";
import { PatchRestoreForm } from "@/components/patch-restore-form";
import { getT } from "@/lib/lang";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function PatchRestore() {
  const { t } = await getT();
  return <main className="site-shell"><SiteNav /><section className="checkout-card">
    <h1>{t("patch.restore.title")}</h1><p>{t("patch.restore.body")}</p><PatchRestoreForm />
  </section></main>;
}
