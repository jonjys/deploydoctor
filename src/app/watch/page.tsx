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
  const token = typeof params.token === "string" && /^[\w.-]{20,300}$/.test(params.token) ? params.token : "";
  const state = params.state === "confirmed" && repo ? "confirmed" : params.state === "unsubscribed" ? "unsubscribed"
    : params.state === "confirm" && token ? "confirm" : params.state === "unsubscribe" && token ? "unsubscribe" : params.state === "failed" ? "failed" : "invalid";
  return <main className="site-shell"><SiteNav /><section className="checkout-card">
    {state === "confirm" ? <><h1>{t("watch.confirmPromptTitle")}</h1><p>{t("watch.confirmPromptBody")}</p>
      <form method="post" action="/api/watch/confirm"><input type="hidden" name="token" value={token} />
        <button className="cta-button" type="submit">{t("watch.confirmButton")}</button></form></>
      : state === "unsubscribe" ? <><h1>{t("watch.unsubscribePromptTitle")}</h1>
      <form method="post" action={`/api/watch/unsubscribe?token=${encodeURIComponent(token)}`}><input type="hidden" name="from" value="page" />
        <button className="cta-button" type="submit">{t("watch.unsubscribeButton")}</button></form></>
      : state === "confirmed" ? <><h1>{t("watch.confirmedTitle", { repo })}</h1><p>{t("watch.confirmedBody")}</p>
      {report && <p><Link href={`/r/${report}`}>{t("watch.openReport")} →</Link></p>}</>
      : state === "unsubscribed" ? <><h1>{t("watch.unsubscribedTitle")}</h1><p>{t("watch.unsubscribedBody")}</p></>
      : state === "failed" ? <><h1>{t("watch.failedTitle")}</h1><p>{t("watch.linkFailed")}</p></>
      : <><h1>{t("watch.invalidTitle")}</h1><p>{t("watch.invalidBody")}</p></>}
    <p><Link href="/">{t("watch.home")}</Link></p>
  </section></main>;
}
