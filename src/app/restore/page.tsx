import { SiteNav } from "@/components/site-nav";
import { RestoreForm } from "@/components/restore-form";
import { getT } from "@/lib/lang";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("restore.title"), robots: { index: false, follow: false } };
}
export default async function Restore() {
  const { t } = await getT();
  return <main className="site-shell"><SiteNav /><section className="checkout-card"><h1>{t("restore.title")}</h1>
    <p>{t("restore.body")}</p><RestoreForm /></section></main>;
}
