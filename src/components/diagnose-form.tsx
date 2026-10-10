"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/lang";
import { CopyTextButton } from "@/components/copy-text-button";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";

type Diagnosis = {
  verdict: "diagnosed" | "needs_more_context" | "not_a_build_log";
  title: string;
  rootCause: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  steps: string[];
  patch: { file: string; code: string };
  verify: string;
  missingContext: string[];
};

const MAX = 12_000;

/** Paste a failing build log, get Claude's diagnosis. The free allowance and passes are enforced by /api/diagnose. */
export function DiagnoseForm() {
  const t = useT();
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setPaywall(false); setResult(null);
    try {
      const response = await fetch("/api/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ log }) });
      const data = await response.json() as { diagnosis?: Diagnosis; error?: string; paywall?: boolean };
      if (!response.ok || !data.diagnosis) {
        setPaywall(Boolean(data.paywall));
        throw new Error(data.error || t("diag.failed"));
      }
      setResult(data.diagnosis);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("diag.failed"));
    }
    setBusy(false);
  }

  if (result) {
    const patch = result.patch.code.trim();
    return (
      <section className="diag-result" aria-live="polite">
        <p className="section-kicker">
          {result.verdict === "diagnosed" ? t(`diag.confidence.${result.confidence}`) : t(`diag.verdict.${result.verdict}`)}
        </p>
        <h2>{result.title}</h2>
        <h3>{t("diag.cause")}</h3>
        <p>{result.rootCause}</p>
        {result.evidence.length > 0 && <>
          <h3>{t("diag.evidence")}</h3>
          <pre><code>{result.evidence.join("\n")}</code></pre>
        </>}
        {result.steps.length > 0 && <>
          <h3>{t("diag.steps")}</h3>
          <ol>{result.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </>}
        {patch && <>
          <h3>{t("diag.patch")}{result.patch.file ? `: ${result.patch.file}` : ""}</h3>
          <pre><code>{patch}</code></pre>
          <p><CopyTextButton text={patch} label={t("report.copyFile")} copiedLabel={t("report.copied")} /></p>
        </>}
        {result.verify && <>
          <h3>{t("diag.verify")}</h3>
          <p>{result.verify}</p>
        </>}
        {result.missingContext.length > 0 && <>
          <h3>{t("diag.missing")}</h3>
          <ul>{result.missingContext.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </>}
        <p className="diag-note">{t("diag.ai")}</p>
        <div className="diag-actions">
          <button className="cta-button" type="button" onClick={() => { setResult(null); setLog(""); }}>{t("diag.again")}</button>
          <Link href="/">{t("diag.scanCta")} →</Link>
        </div>
      </section>
    );
  }

  return (
    <form className="diag-form" onSubmit={submit}>
      <label htmlFor="diag-log">{t("diag.label")}</label>
      <textarea id="diag-log" value={log} onChange={(event) => setLog(event.target.value.slice(0, MAX))}
        placeholder={t("diag.placeholder")} rows={14} spellCheck={false} required />
      <div className="diag-meta">
        <span>{t("diag.privacy")}</span>
        <span>{t("diag.count", { n: log.length })}</span>
      </div>
      <button className="cta-button" type="submit" disabled={busy || log.trim().length < 20}>
        {busy ? t("diag.working") : `${t("diag.submit")} →`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {paywall && <div className="paywall" role="status"><strong>{t("paywall.title")}</strong>
        <div className="pass-actions">
          <ScanCheckoutButton plan="day">{t("paywall.day")}</ScanCheckoutButton>
          <ScanCheckoutButton plan="week" style={{ background: "transparent" }}>{t("paywall.week")}</ScanCheckoutButton>
        </div>
      </div>}
    </form>
  );
}
