"use client";

import { useState } from "react";
import Link from "next/link";
import { AREA_NAMES, type SiteArea, type SiteCheckReport, type SiteFinding } from "@/lib/site-check-copy";

const AREAS: SiteArea[] = ["keys", "trust", "vat", "ai"];
const MARK: Record<SiteFinding["status"], string> = { fail: "✕", warn: "!", pass: "✓", info: "i" };
const LABEL: Record<SiteFinding["status"], string> = { fail: "Fix now", warn: "Worth fixing", pass: "OK", info: "Note" };

export function SiteCheckForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SiteCheckReport | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setReport(null);
    try {
      const response = await fetch("/api/site-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "The check could not finish.");
      else setReport(body as SiteCheckReport);
    } catch { setError("The check could not finish. Check your connection."); }
    finally { setBusy(false); }
  }

  const leaked = report?.findings.some(finding => finding.area === "keys" && finding.status === "fail") ?? false;
  // Only a result with no key finding at all may say "no leaked keys" (a public test key is a warning, not a pass).
  const keysClean = !!report && report.findings.filter(finding => finding.area === "keys").every(finding => finding.status === "pass");
  const share = report && keysClean && !report.summary.fail
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(`Ran a live site check on ${report.host}: no leaked keys, ${report.summary.pass} checks passed ✅\n\nKeys, EU rules, VAT number and AI search in one go. Check yours:`)}&url=${encodeURIComponent("https://deploydoctor.nyttolabs.com/site-check")}`
    : null;

  return (
    <div className="leak-check">
      <form className="repo-form" onSubmit={submit}>
        <div className="input-shell">
          <span aria-hidden="true" className="leak-icon">🛡️</span>
          <label className="sr-only" htmlFor="site-check-url">Live site address</label>
          <input className="repo-input" id="site-check-url" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="my-shop.com" value={url} onChange={event => setUrl(event.target.value)} required />
          <button className="scan-button" type="submit" disabled={busy}>{busy ? "Checking…" : "Check my site"} <span aria-hidden="true">→</span></button>
        </div>
        <p className="plugin-line">Free. Reads only what every visitor already sees. Secrets are masked and nothing is saved. Takes up to half a minute.</p>
      </form>

      {error && <p className="leak-error" role="alert">{error}</p>}

      {report && (
        <section className="leak-result" aria-live="polite">
          <p className="section-kicker">{report.host} · {report.leaks.files} {report.leaks.files === 1 ? "file" : "files"} read{report.leaks.partial ? " · partial" : ""}</p>
          <h2 className={report.summary.fail ? "leak-bad" : "leak-good"}>
            {report.summary.fail ? `${report.summary.fail} to fix now` : "Nothing urgent"}{report.summary.warn ? `, ${report.summary.warn} worth fixing` : ""} · {report.summary.pass} OK
          </h2>
          {AREAS.map(area => {
            const items = report.findings.filter(finding => finding.area === area);
            if (!items.length) return null;
            return (
              <div key={area} className="site-area">
                <h3>{AREA_NAMES[area]}</h3>
                <ul className="site-findings">
                  {items.map(finding => (
                    <li key={finding.id} className={`is-${finding.status}`}>
                      <span className="site-mark" aria-label={LABEL[finding.status]} title={LABEL[finding.status]}>{MARK[finding.status]}</span>
                      <div>
                        <strong>{finding.title}</strong>
                        <p>{finding.detail}</p>
                        {finding.fix && finding.status !== "pass" && <p className="site-fix">{finding.fix}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {leaked && <p><strong>Removing a key from the code is not enough:</strong> the old build and anyone who copied it still have it. Rotate first, then redeploy. <Link href="/#scan-repository">Scan the repo</Link> to see which file reads it.</p>}
          {report.leaks.publicKeys.length > 0 && <p className="leak-ok">Public keys found, which are fine to ship: {[...new Set(report.leaks.publicKeys.map(key => key.kind === "stripe-publishable" ? "Stripe publishable key" : "Supabase public key"))].join(", ")}.{report.leaks.publicKeys.some(key => key.kind !== "stripe-publishable") ? " The Supabase key is only safe with Row Level Security on every table." : ""}</p>}
          <p className="plugin-line">Also check email deliverability, link previews and Google basics with <a href={`https://sellscore.nyttolabs.com/r/${encodeURIComponent(report.host.replace(/^www\./, ""))}`}>SellScore</a>.</p>
          {share && <p><a className="cta-button" href={share} target="_blank" rel="noopener noreferrer">Share the result on X</a></p>}
        </section>
      )}
    </div>
  );
}
