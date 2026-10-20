"use client";
import { useState, type FormEvent } from "react";
import { useT } from "@/components/lang";

export function PatchRestoreForm() {
  const t = useT();
  const [sessionId, setSessionId] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/patch/restore", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.trim(), recoveryKey: key.trim() }) });
      const result = await response.json() as { href?: string; error?: string };
      if (!response.ok || !result.href?.startsWith("/patch/success?session_id=")) throw new Error(result.error ?? t("patch.restore.failed"));
      window.location.assign(result.href);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("patch.restore.failed")); setBusy(false); }
  }
  return <form onSubmit={event => void submit(event)} className="patch-restore">
    <label>{t("restore.session")}<input required value={sessionId} onChange={event => setSessionId(event.target.value)} maxLength={220} autoComplete="off" /></label>
    <label>{t("patch.recovery.key")}<input required type="password" value={key} onChange={event => setKey(event.target.value)} maxLength={64} autoComplete="off" /></label>
    <button className="cta-button" disabled={busy}>{busy ? t("restore.busy") : t("restore.submit")}</button>
    {error && <p role="alert" className="patch-error">{error}</p>}
  </form>;
}
