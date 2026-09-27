"use client";
import { useState } from "react";
import { useT } from "@/components/lang";

export function RestoreForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/restore", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, sessionId }) });
      const result = (await response.json()) as { href?: string; error?: string };
      if (!response.ok || !result.href) { setError(result.error ?? t("restore.failed")); return; }
      window.location.assign(result.href);
    } catch { setError(t("restore.failed")); } finally { setBusy(false); }
  }

  return <form className="restore-form" onSubmit={submit}>
    <label htmlFor="restore-email">{t("restore.email")}</label>
    <input id="restore-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
    <label htmlFor="restore-session">{t("restore.session")}</label>
    <input id="restore-session" autoComplete="off" spellCheck={false} required placeholder="cs_live_…" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
    <p className="restore-hint">{t("restore.hint")}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="cta-button" type="submit" disabled={busy}>{busy ? t("restore.busy") : t("restore.submit")}</button>
  </form>;
}
