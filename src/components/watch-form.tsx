"use client";

import { useState } from "react";
import { useT } from "@/components/lang";

/** Watch this repo: an email field under a public report. The address gets a confirmation link before anything else. */
export function WatchForm({ reportId, repo }: { reportId: string; repo: string }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/watch", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, email }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || t("watch.failed"));
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("watch.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="watch-section" aria-labelledby="watch-heading">
      <div>
        <h2 id="watch-heading">{t("watch.title")}</h2>
        <p>{t("watch.body", { repo })}</p>
      </div>
      {sent ? <p className="watch-sent" role="status">{t("watch.sent")}</p> : (
        <form className="watch-form" onSubmit={submit}>
          <label htmlFor="watch-email">{t("watch.emailLabel")}</label>
          <div className="watch-row">
            <input id="watch-email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com"
              value={email} onChange={(event) => setEmail(event.target.value)} />
            <button className="cta-button" type="submit" disabled={busy}>{busy ? t("watch.busy") : t("watch.submit")}</button>
          </div>
          <p className="watch-note">{t("watch.note")}</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
