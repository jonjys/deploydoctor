"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLang } from "@/components/lang";
import type { ScanInsights } from "@/lib/scan-insights";

export function ScanActivity({ initial }: { initial: ScanInsights | null }) {
  const sv = useLang() === "sv";
  const [data, setData] = useState(initial);
  const [paused, setPaused] = useState(false);
  const [unavailable, setUnavailable] = useState(!initial);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/stats", { signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        setData(await response.json()); setUnavailable(false);
      } catch { if (!controller.signal.aborted) setUnavailable(true); }
      finally { pending = false; }
    }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);
  const events = data?.activity ?? [];
  const eventText = (at: string) => `${sv ? "Ett offentligt repo skannades" : "A public repo was scanned"} · ${new Date(at).toLocaleTimeString(sv ? "sv-SE" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
  return <section className="activity-panel" aria-label={sv ? "Senaste skanningarna" : "Recent scans"}>
    <div className="activity-heading"><span><span className="activity-dot" aria-hidden="true" />{sv ? "Senaste aktiviteten" : "Recent activity"}</span><Link href="/stats">{sv ? "Se statistiken" : "See the stats"} →</Link></div>
    {events.length > 0 ? <><div className={`activity-window${paused ? " is-paused" : ""}`} tabIndex={0} aria-label={sv ? "Skanningar senaste dygnet. Raden pausas vid fokus." : "Scans in the past 24 hours. The row pauses on focus."}>
      <div className="activity-track"><ul>{events.map((event, i) => <li key={i}><span aria-hidden="true">✓</span> {eventText(event.at)}</li>)}</ul><ul aria-hidden="true">{events.map((event, i) => <li key={i}><span>✓</span> {eventText(event.at)}</li>)}</ul></div>
    </div><div className="activity-caption"><small>{unavailable ? (sv ? "Anslutningen bröts. Visar senast hämtad aktivitet." : "Connection unavailable. Showing the last fetched activity.") : (sv ? "Anonymiserat · tider avrundade till timme · uppdateras varje minut" : "Anonymous · times rounded to the hour · refreshes every minute")}</small><button type="button" className="link-button" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? (sv ? "Starta" : "Play") : (sv ? "Pausa" : "Pause")}</button></div></> : <p className="activity-empty">{unavailable ? (sv ? "Aktiviteten kan inte hämtas just nu." : "Activity is unavailable right now.") : (sv ? "Inga kompletta offentliga skanningar senaste dygnet ännu." : "No complete public scans in the past 24 hours yet.")}</p>}
  </section>;
}
