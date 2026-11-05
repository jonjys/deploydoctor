"use client";

import { useState } from "react";
import Link from "next/link";
import { LEAK_COPY, type LeakReport } from "@/lib/bundle-leaks-copy";

const PUBLIC_NAMES = { "stripe-publishable": "Stripe publishable key", "supabase-anon": "Supabase anon key", "supabase-publishable": "Supabase publishable key" } as const;

export function LeakCheckForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<LeakReport | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setReport(null);
    try {
      const response = await fetch("/api/leak-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "The check could not finish.");
      else setReport(body as LeakReport);
    } catch { setError("The check could not finish. Check your connection."); }
    finally { setBusy(false); }
  }

  const critical = report?.leaks.filter(leak => leak.severity === "critical") ?? [];
  const share = report && !critical.length
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(`Checked my live site for API keys baked into the JavaScript: ${report.files} files, 0 leaked secrets ✅\n\nGitHub secret scanning can't see these. Check yours:`)}&url=${encodeURIComponent("https://deploydoctor.nyttolabs.com/leak-check")}`
    : null;

  return (
    <div className="leak-check">
      <form className="repo-form" onSubmit={submit}>
        <div className="input-shell">
          <span aria-hidden="true" className="leak-icon">🔑</span>
          <label className="sr-only" htmlFor="site-url">Live site address</label>
          <input className="repo-input" id="site-url" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="my-app.vercel.app" value={url} onChange={event => setUrl(event.target.value)} required />
          <button className="scan-button" type="submit" disabled={busy}>{busy ? "Checking…" : "Check for leaks"} <span aria-hidden="true">→</span></button>
        </div>
        <p className="plugin-line">Free. Reads only what every visitor already downloads. Values are masked and nothing is saved.</p>
      </form>

      {error && <p className="leak-error" role="alert">{error}</p>}

      {report && (
        <section className="leak-result" aria-live="polite">
          <p className="section-kicker">{report.host} · {report.files} {report.files === 1 ? "file" : "files"} · {Math.round(report.bytes / 1024)} KB read{report.partial ? " · partial" : ""}</p>
          {critical.length ? (
            <h2 className="leak-bad">{critical.length} secret {critical.length === 1 ? "key is" : "keys are"} public on your live site</h2>
          ) : (
            <h2 className="leak-good">No secret keys found in your live JavaScript</h2>
          )}
          {report.leaks.length > 0 && (
            <ol className="leak-list">
              {report.leaks.map(leak => (
                <li key={`${leak.kind}${leak.masked}`} className={leak.severity === "critical" ? "is-critical" : "is-warning"}>
                  <strong>{LEAK_COPY[leak.kind].name}</strong> <code>{leak.masked}</code>
                  <p>Found in <code>{leak.file}</code>. {LEAK_COPY[leak.kind].fix}</p>
                </li>
              ))}
            </ol>
          )}
          {critical.length > 0 && <p><strong>Removing it from the code is not enough:</strong> the old build and anyone who copied the key still have it. Rotate first, then redeploy. <Link href="/#scan-repository">Scan the repo</Link> to see which file reads it.</p>}
          {report.publicKeys.length > 0 && <p className="leak-ok">Public by design, and fine to ship: {report.publicKeys.map(key => PUBLIC_NAMES[key.kind]).join(", ")}.{report.publicKeys.some(key => key.kind !== "stripe-publishable") ? " The Supabase key is only safe with Row Level Security on every table." : ""}</p>}
          {report.partial && <p className="plugin-line">Some files could not be read or were over the size limit, so this result is not complete.</p>}
          {share && <p><a className="cta-button" href={share} target="_blank" rel="noopener noreferrer">Share the clean result on X</a></p>}
        </section>
      )}
    </div>
  );
}
