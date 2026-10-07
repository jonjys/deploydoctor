"use client";

import { useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useT } from "@/components/lang";
import type { ScanPlan } from "@/lib/plans";
import { isStripeCheckoutUrl, scanCheckoutHref } from "@/lib/scan-checkout";

export function ScanCheckoutButton({
  plan,
  reportId,
  checkId,
  context,
  className = "cta-button",
  style,
  children,
}: {
  plan: ScanPlan;
  reportId?: string;
  checkId?: string;
  context?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const href = scanCheckoutHref(plan, reportId, checkId);

  async function start(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, reportId, checkId, ...(context ? { context } : {}) }),
      });
      const result = (await response.json()) as { url?: unknown };
      if (!response.ok || !isStripeCheckoutUrl(result.url)) throw new Error("checkout failed");
      window.location.assign(result.url);
    } catch {
      window.location.assign(href);
    }
  }

  return (
    <a className={className} style={style} href={href} aria-busy={busy || undefined} onClick={(event) => void start(event)}>
      {busy ? t("checkout.opening") : children}
    </a>
  );
}
