import Link from "next/link";
import { cookies } from "next/headers";
import { SiteNav } from "@/components/site-nav";
import { CopyTextButton } from "@/components/copy-text-button";
import { getT } from "@/lib/lang";
import type { MessageKey } from "@/lib/i18n";
import { PatchError } from "@/lib/patch/case-patch";
import { PATCH_ACCESS_COOKIE, readAccessKeys } from "@/lib/patch/payments";
import { retrievePaidPatch } from "@/lib/patch/service";

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const APPLY = [
  "git pull",
  "git apply --check patchjouren.patch && git apply patchjouren.patch",
  'git commit -am "Fix import letter case for Linux builds"',
  "git push",
].join("\n");

/** Stripe returns the buyer here. The patch is shown only once Stripe confirms the payment for this browser. */
export default async function PatchSuccess({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const { t } = await getT();
  let order: Awaited<ReturnType<typeof retrievePaidPatch>> | null = null;
  let failure = "";
  if (sessionId) {
    try {
      order = await retrievePaidPatch(sessionId, readAccessKeys((await cookies()).get(PATCH_ACCESS_COOKIE)?.value));
    } catch (error) {
      failure = error instanceof PatchError ? t(`patch.reason.${error.code}` as MessageKey) : t("patch.unavailable");
    }
  }

  return <main className="site-shell"><SiteNav /><section className="checkout-card">
    <h1>{t("patch.successTitle")}</h1>
    {!sessionId && <p>{t("patch.openLink")}</p>}
    {failure && <p role="alert" className="patch-error">{t("patch.failed")} {failure}</p>}
    {order && <>
      <p>{t("patch.successPaid", { fixes: order.fixes, repo: order.repoUrl.replace("https://github.com/", ""), commit: order.commitSha.slice(0, 7) })}</p>
      <p><a className="cta-button" href={`/api/patch/download?session_id=${encodeURIComponent(sessionId!)}`}>{t("patch.download")}</a></p>
      <p>{t("patch.apply", { commit: order.commitSha.slice(0, 7) })}</p>
      <pre className="patch-file"><code>{APPLY}</code></pre>
      <p>{t("patch.after")}</p>
      <pre className="patch-file"><code>{order.patch}</code></pre>
      <CopyTextButton text={order.patch} label={t("patch.copy")} copiedLabel={t("report.copied")} />
      <p><Link href={`/r/${order.reportId}`}>{t("patch.backToReport")}</Link></p>
    </>}
  </section></main>;
}
