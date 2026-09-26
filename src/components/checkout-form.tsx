"use client";
import { useState, type FormEvent } from "react";
import type { Plan } from "@/lib/plans";

export function CheckoutForm({ plan, reportId, checkId, configured }: { plan: Plan; reportId?: string; checkId?: string; configured: boolean }) {
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/stripe/create-checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, reportId, checkId, context }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Kunde inte starta betalningen.");
      window.location.assign(result.url);
    } catch (error) { setError(error instanceof Error ? error.message : "Försök igen."); setBusy(false); }
  }
  return <form onSubmit={submit} className="checkout-form"><label htmlFor="context">GitHub repo URL eller var vi pratade (valfritt)</label>
    <input id="context" placeholder="jonjys/skrivklart eller länk till rapport" value={context} onChange={(event) => setContext(event.target.value)} maxLength={255} />
    <p>Endast e-postadress krävs som kontaktuppgift i nästa steg. Betalning sker säkert hos Stripe.</p>
    <button className="cta-button" disabled={busy || !configured}>{busy ? "Öppnar Stripe…" : "Fortsätt till betalning →"}</button>
    {!configured && <p role="status">Betalning är inte aktiverad ännu. Du kan fortfarande skapa och dela gratisrapporter.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </form>;
}
