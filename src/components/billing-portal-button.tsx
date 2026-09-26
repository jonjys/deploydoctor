"use client";
import { useState } from "react";
import { useT } from "@/components/lang";
export function BillingPortalButton() {
  const t = useT();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign(data.url);
    } catch (error) { setError(error instanceof Error ? error.message : t("checkout.retry")); setBusy(false); }
  }
  return <div><button className="cta-button" disabled={busy} onClick={open}>{t("account.manage")}</button>{error && <p role="alert">{error}</p>}</div>;
}
