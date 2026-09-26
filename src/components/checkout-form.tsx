"use client";
import { useState, type FormEvent } from "react";
import type { Plan } from "@/lib/plans";
import { useT } from "@/components/lang";

export function CheckoutForm({ plan, reportId, checkId, configured }: { plan: Plan; reportId?: string; checkId?: string; configured: boolean }) {
  const t = useT();
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/create-checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, reportId, checkId, context }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || t("checkout.failed"));
      window.location.assign(result.url);
    } catch (error) { setError(error instanceof Error ? error.message : t("checkout.retry")); setBusy(false); }
  }
  return <form onSubmit={submit} className="checkout-form"><label htmlFor="context">{t("pay.field")}</label>
    <input id="context" placeholder={t("checkout.placeholder")} value={context} onChange={(event) => setContext(event.target.value)} maxLength={255} />
    <p>{t("checkout.emailNote")}</p>
    <button className="cta-button" disabled={busy || !configured}>{busy ? t("checkout.opening") : t("checkout.continue")}</button>
    {!configured && <p role="status">{t("checkout.notConfigured")}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </form>;
}
