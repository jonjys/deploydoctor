"use client";
import { useState } from "react";
export function BillingPortalButton() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign(data.url);
    } catch (error) { setError(error instanceof Error ? error.message : "Försök igen."); setBusy(false); }
  }
  return <div><button className="cta-button" disabled={busy} onClick={open}>Hantera / avsluta abonnemang</button>{error && <p role="alert">{error}</p>}</div>;
}
