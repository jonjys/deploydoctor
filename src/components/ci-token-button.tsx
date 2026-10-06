"use client";
import { useState } from "react";
import { useT } from "@/components/lang";

/** Reveals an API token for GitHub Actions. Only the paying browser can ask for one, and it is shown once per click. */
export function CiTokenButton() {
  const t = useT();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function create() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch("/api/ci-token", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setToken(data.token);
    } catch (error) { setError(error instanceof Error ? error.message : t("checkout.retry")); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(token); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); } catch { setError(t("ci.copyFailed")); }
  }
  return <div className="ci-token">
    {token ? <>
      <textarea aria-label={t("ci.tokenLabel")} readOnly value={token} rows={3} onFocus={(event) => event.currentTarget.select()} />
      <div className="ci-token-actions">
        <button className="cta-button" type="button" onClick={copy}>{copied ? t("ci.copied") : t("ci.copy")}</button>
        <span>{t("ci.tokenShownOnce")}</span>
      </div>
    </> : <button className="cta-button" type="button" disabled={busy} onClick={create}>{t("ci.create")}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
