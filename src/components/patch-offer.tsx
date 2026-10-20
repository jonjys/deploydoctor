"use client";

import { useState } from "react";
import { useT } from "@/components/lang";
import type { MessageKey } from "@/lib/i18n";
import { isStripeCheckoutUrl } from "@/lib/scan-checkout";
import { PatchRecoveryKey } from "@/components/patch-recovery-key";

type Fix = { file: string; line: number; from: string; to: string };
type Skipped = { file: string; line: number; specifier: string; reason: string };
type Offer =
  | { eligible: true; fixes: Fix[]; skipped: Skipped[]; files: string[]; commitSha: string; amountMinor: number; quoteToken: string; recoveryKey: string }
  | { eligible: false; reason: string; skipped: Skipped[] };

const reasonKey = (reason: string) => `patch.reason.${reason}` as MessageKey;

/** The verified patch offer on the imports card: check for a verified automatic patch, see the price, pay. */
export function PatchOffer({ reportId }: { reportId: string }) {
  const t = useT();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState<"check" | "pay" | null>(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof result.code === "string" ? result.code : "";
      throw new Error(code ? t(reasonKey(code)) : typeof result.error === "string" ? result.error : t("patch.unavailable"));
    }
    return result;
  }

  async function check() {
    setBusy("check"); setError("");
    try { setOffer(await post({ action: "prepare", reportId }) as Offer); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("patch.unavailable")); }
    finally { setBusy(null); }
  }

  async function pay() {
    if (!offer?.eligible || !consent) return;
    setBusy("pay"); setError("");
    try {
      const result = await post({ action: "checkout", quoteToken: offer.quoteToken, consent: true, expectedAmountMinor: offer.amountMinor });
      if (!isStripeCheckoutUrl(result.url)) throw new Error(t("patch.unavailable"));
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("patch.unavailable"));
      setBusy(null);
    }
  }

  return (
    <div className="patch-offer">
      <p className="section-kicker">{t("patch.kicker")}</p>
      {!offer && <>
        <p>{t("patch.lead")}</p>
        <button type="button" className="copy-button" onClick={() => void check()} disabled={busy !== null}>
          {busy === "check" ? t("patch.checking") : t("patch.check")}
        </button>
      </>}
      {offer?.eligible === false && <p>{t(`patch.none.${offer.reason}` as MessageKey)}</p>}
      {offer?.eligible && <>
        <p>{t("patch.flow")}</p>
        <p><strong>{t("patch.ready", { fixes: offer.fixes.length, files: offer.files.length, commit: offer.commitSha.slice(0, 7) })}</strong></p>
        <ul className="evidence-list">
          {offer.fixes.map((fix) => <li key={`${fix.file}:${fix.line}`}>↳ {fix.file}:{fix.line} <code>{fix.from}</code> → <code>{fix.to}</code></li>)}
        </ul>
        <p>{t("patch.price")}</p>
        <PatchRecoveryKey recoveryKey={offer.recoveryKey} />
        <label className="patch-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {t("patch.consent")}
        </label>
        <button type="button" className="cta-button" onClick={() => void pay()} disabled={!consent || busy !== null} aria-busy={busy === "pay" || undefined}>
          {busy === "pay" ? t("patch.opening") : t("patch.pay")}
        </button>
      </>}
      {offer && offer.skipped.length > 0 && <>
        <p>{t("patch.notCovered")}</p>
        <ul className="evidence-list">
          {offer.skipped.map((item) => <li key={`${item.file}:${item.line}:${item.specifier}`}>↳ {item.file}:{item.line} <code>{item.specifier}</code> ({t(reasonKey(item.reason))})</li>)}
        </ul>
      </>}
      {error && <p role="alert" className="patch-error">{error}</p>}
    </div>
  );
}
