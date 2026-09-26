import { SiteNav } from "@/components/site-nav";
import { CheckoutConfirmation } from "@/components/checkout-confirmation";
import { getT } from "@/lib/lang";
export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  const { t } = await getT();
  return <main className="site-shell"><SiteNav /><section className="checkout-card"><h1>{t("success.title")}</h1>
    {session_id ? <CheckoutConfirmation sessionId={session_id} /> : <p>{t("success.openLink")}</p>}
  </section></main>;
}
