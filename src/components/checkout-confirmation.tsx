"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function CheckoutConfirmation({ sessionId }: { sessionId: string }) {
  const [message, setMessage] = useState("Vi väntar på betalningsbekräftelsen…");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function confirm(count = 0) {
      try {
        const response = await fetch("/api/stripe/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }), signal: controller.signal });
        const result = await response.json();
        if (canceled) return;
        if (!response.ok) { setMessage(result.error); return; }
        if (result.pending) {
          setMessage("Betalningen behandlas fortfarande. När Stripe bekräftar den aktiveras ditt köp automatiskt.");
          if (count < 8) timer = setTimeout(() => confirm(count + 1), 2500);
        } else { setReady(true); setMessage(result.repair ? "Tack! Din fixbeställning visas under My scans när betalningen registrerats." : "Klart! Ditt abonnemang eller pass är aktiverat."); }
      } catch { if (!canceled) setMessage("Kunde inte hämta bekräftelsen. Försök igen om en stund."); }
    }
    void confirm();
    return () => { canceled = true; controller.abort(); clearTimeout(timer); };
  }, [sessionId, attempt]);
  return <><p role="status">{message}</p><div className="action-buttons">{!ready && <button className="cta-button" onClick={() => setAttempt(attempt + 1)}>Kontrollera igen</button>}
    <Link className="cta-button" href="/account">My scans →</Link></div></>;
}
