"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/lang";

type Item = { title: string; status: string; file?: string; line?: number; problem: string };
type Offer = {
  needsRepo?: boolean; eligible?: boolean; isPrivate?: boolean; headline?: string; repoUrl?: string;
  items?: Item[]; fixes?: Item[]; quoteToken?: string | null; promoRemaining?: number | null;
  message?: string; error?: string; commitSha?: string | null;
};

export function FixForm({ initialTarget, github }: { initialTarget: string; github: string | null }) {
  const t = useT();
  const [target, setTarget] = useState(initialTarget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [consent, setConsent] = useState(false);
  const [liveUrl, setLiveUrl] = useState("");
  const [prUrl, setPrUrl] = useState("");

  async function diagnose(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setOffer(null); setPrUrl("");
    try {
      const response = await fetch("/api/fix/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
      const data = await response.json() as Offer;
      if (!response.ok) throw new Error(data.error || "The repository could not be diagnosed.");
      setOffer(data);
      if (data.needsRepo && data.message) setError(data.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The repository could not be diagnosed.");
    }
    setBusy(false);
  }

  async function checkout() {
    if (!offer?.quoteToken) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fix/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteToken: offer.quoteToken, consent, liveUrl, errorSummary: offer.headline }),
      });
      const data = await response.json() as { url?: string; promo?: boolean; receipt?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Checkout could not be started.");
      if (data.promo && data.receipt) {
        const opened = await fetch("/api/fix/pull-request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteToken: offer.quoteToken, receipt: data.receipt, consent, liveUrl, errorSummary: offer.headline }),
        });
        const pull = await opened.json() as { url?: string; error?: string; needsGitHub?: boolean };
        if (!opened.ok) throw new Error(pull.error || "The pull request could not be opened.");
        setPrUrl(pull.url || "");
      } else if (data.url) {
        window.location.assign(data.url);
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout could not be started.");
    }
    setBusy(false);
  }

  const repoQuery = offer?.repoUrl?.replace("https://github.com/", "") ?? "";
  return (
    <>
      <form className="diag-form" onSubmit={diagnose}>
        <label htmlFor="fix-target">{t("fix.label")}</label>
        <input id="fix-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={t("fix.placeholder")} required maxLength={20000} />
        <p className="diag-note">{t("fix.promise")}</p>
        <button className="cta-button" type="submit" disabled={busy || target.trim().length < 3}>{busy ? t("fix.working") : t("fix.submit")}</button>
        <p><Link href={`/api/fix/github/install?repo=${encodeURIComponent(repoQuery)}`}>{t("fix.connect")}</Link>
          {" · "}<Link href={`/api/fix/github/connect?repo=${encodeURIComponent(repoQuery)}`}>{t("fix.connect")} OAuth</Link></p>
        {github === "connected" && <p role="status">GitHub connected.</p>}
        {github === "failed" && <p className="form-error" role="alert">GitHub could not be connected. Try again.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      {offer && !offer.needsRepo && (
        <section className="diag-result" aria-live="polite">
          <h2>{offer.headline}</h2>
          <ul>{(offer.items ?? []).map((item, index) => <li key={`${item.file ?? item.title}-${index}`}><strong>{item.title}</strong>{item.file ? ` · ${item.file}${item.line ? `:${item.line}` : ""}` : ""}<br />{item.problem}</li>)}</ul>
          {offer.eligible && offer.fixes && offer.fixes.length > 0 && <>
            <h3>{t("fix.kicker")}</h3>
            <ul>{offer.fixes.map((fix) => <li key={`${fix.file}:${fix.line}`}>{fix.file}:{fix.line}. {fix.problem}</li>)}</ul>
            <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {t("fix.consent")}</label>
            {consent && <p><label htmlFor="fix-live">{t("fix.live")}</label><input id="fix-live" value={liveUrl} onChange={(event) => setLiveUrl(event.target.value)} placeholder="https://your-app.vercel.app" /></p>}
            <button className="cta-button" type="button" disabled={busy} onClick={checkout}>
              {offer.promoRemaining && offer.promoRemaining > 0 ? t("fix.free", { n: offer.promoRemaining }) : t("fix.pay")}
            </button>
          </>}
          {offer.eligible === false && !offer.isPrivate && <p>{t("fix.none")}</p>}
          {prUrl && <p><a href={prUrl}>Pull request</a></p>}
        </section>
      )}
    </>
  );
}
