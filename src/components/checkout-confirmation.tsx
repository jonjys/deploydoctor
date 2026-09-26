"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang";

export function CheckoutConfirmation({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [message, setMessage] = useState(t("confirm.waiting"));
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
          setMessage(t("confirm.pending"));
          if (count < 8) timer = setTimeout(() => confirm(count + 1), 2500);
        } else { setReady(true); setMessage(result.repair ? t("confirm.repair") : t("confirm.done")); }
      } catch { if (!canceled) setMessage(t("confirm.failed")); }
    }
    void confirm();
    return () => { canceled = true; controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t only changes with the language
  }, [sessionId, attempt]);
  return <><p role="status">{message}</p><div className="action-buttons">{!ready && <button className="cta-button" onClick={() => setAttempt(attempt + 1)}>{t("confirm.recheck")}</button>}
    <Link className="cta-button" href="/account">{t("nav.myScans")} →</Link></div></>;
}
