import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { getT } from "@/lib/lang";
import { watchEnabled } from "@/lib/watch";

export const metadata = { robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the confirm and unsubscribe links in watch emails land. */
export default async function Watch({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!watchEnabled()) notFound();
  const params = await searchParams;
  const { t } = await getT();
  const repo = typeof params.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(params.repo) ? params.repo : "";
  const report = typeof params.report === "string" && UUID.test(params.report) ? params.report : "";
  const state = params.state === "confirmed" && repo ? "confirmed" : params.state === "unsubscribed" ? "unsubscribed" : "invalid";
  return <main className="site-shell"><SiteNav /><section className="checkout-card">
    {state === "confirmed" ? <><h1>{t("watch.confirmedTitle", { repo })}</h1><p>{t("watch.confirmedBody")}</p>
      {report && <p><Link href={`/r/${report}`}>{t("watch.openReport")} →</Link></p>}</>
      : state === "unsubscribed" ? <><h1>{t("watch.unsubscribedTitle")}</h1><p>{t("watch.unsubscribedBody")}</p></>
      : <><h1>{t("watch.invalidTitle")}</h1><p>{t("watch.invalidBody")}</p></>}
    <p><Link href="/">{t("watch.home")}</Link></p>
  </section></main>;
}
