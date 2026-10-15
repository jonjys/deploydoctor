"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang";
import { CopyTextButton } from "@/components/copy-text-button";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { SolvedPrompt } from "@/components/solved-prompt";
import { clearDiagnosis, loadDiagnosis, saveDiagnosis, type Diagnosis } from "@/lib/saved-diagnosis";
import { clonedRepo } from "@/lib/vercel-log";

const MAX = 12_000;

/** Paste a failing build log, get Claude's diagnosis. The free allowance and passes are enforced by /api/diagnose. */
export function DiagnoseForm({ hasPass = false }: { hasPass?: boolean }) {
  const t = useT();
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [resultId, setResultId] = useState("");

  // Back from Stripe: show the diagnosis again, or the log the paywall stopped, instead of an empty form.
  useEffect(() => {
    const saved = loadDiagnosis();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved diagnosis only exists in this browser tab
    setLog(saved.log); setResultId(saved.id); setResult(saved.diagnosis);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setPaywall(false); setResult(null);
    // What this tab kept belongs to the log before, so a failed request must not bring it back.
    clearDiagnosis();
    try {
      const response = await fetch("/api/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ log }) });
      const data = await response.json() as { diagnosis?: Diagnosis; error?: string; paywall?: boolean };
      if (!response.ok || !data.diagnosis) {
        setPaywall(Boolean(data.paywall));
        // The paywall's pass buttons leave for Stripe in this tab: the log waits to be diagnosed on the way back.
        if (data.paywall) saveDiagnosis({ id: "", log, diagnosis: null });
        throw new Error(data.error || t("diag.failed"));
      }
      const id = crypto.randomUUID();
      setResultId(id);
      setResult(data.diagnosis);
      saveDiagnosis({ id, log, diagnosis: data.diagnosis });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("diag.failed"));
    }
    setBusy(false);
  }

  if (result) {
    const patch = result.patch.code.trim();
    // The web scan always reads the default branch, so the box names the repository and never the commit.
    const repo = clonedRepo(log);
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
        {repo && <p className="diag-box"><Link href={`/?repo=${repo}`}>{t("diag.scanRepo", { repo })} →</Link></p>}
        {resultId && <SolvedPrompt key={resultId} kind="diagnosis" target={resultId} />}
        {result.verdict === "diagnosed" && !hasPass && <div className="diag-box diag-offer">
          <p>{t("diag.rescue.body")}</p>
          <ScanCheckoutButton plan="day">{t("diag.rescue.cta")}</ScanCheckoutButton>
        </div>}
        <div className="diag-actions">
          <button className="cta-button" type="button" onClick={() => { clearDiagnosis(); setResult(null); setLog(""); }}>{t("diag.again")}</button>
          {!repo && <Link href="/">{t("diag.scanCta")} →</Link>}
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
        <p>{t("paywall.body")}</p>
        <div className="pass-actions">
          <ScanCheckoutButton plan="day">{t("paywall.day")}</ScanCheckoutButton>
          <ScanCheckoutButton plan="week" style={{ background: "transparent" }}>{t("paywall.week")}</ScanCheckoutButton>
        </div>
      </div>}
    </form>
  );
}
