"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyTextButton } from "@/components/copy-text-button";
import { AREA_NAMES, type SafetyReport } from "@/lib/app-safety-copy";

const VERDICT = {
  "not-safe": { label: "NOT SAFE", className: "is-bad", line: "Fix the red items first. They are open to anyone right now." },
  "no-issues": { label: "NO ISSUES FOUND", className: "is-good", line: "Every check ran, including your database and source files." },
  "public-checks-passed": { label: "PUBLIC CHECKS PASSED", className: "is-mid", line: "Your database and source files were not tested yet. Prove you own the site to run them." },
} as const;

export function SafeForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SafetyReport | null>(null);

  async function run(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/safe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error ?? "The check could not finish."); setReport(null); }
      else setReport(body as SafetyReport);
    } catch { setError("The check could not finish. Check your connection."); }
    finally { setBusy(false); }
  }

  const verdict = report ? VERDICT[report.verdict] : null;
  const share = report && report.verdict !== "not-safe"
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(`Ran "Is my app safe?" on my live app: ${report.summary.pass} checks passed, 0 critical issues${report.owner.verified ? ", database included" : ""}.\n\nCheck yours:`)}&url=${encodeURIComponent("https://deploydoctor.nyttolabs.com/safe")}`
    : null;

  return (
    <div className="safe-check">
      <form className="repo-form" onSubmit={run}>
        <div className="input-shell">
          <span aria-hidden="true" className="leak-icon">🛡️</span>
          <label className="sr-only" htmlFor="safe-url">Live app address</label>
          <input className="repo-input" id="safe-url" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="my-app.lovable.app" value={url} onChange={event => setUrl(event.target.value)} required />
          <button className="scan-button" type="submit" disabled={busy}>{busy ? "Checking…" : "Is it safe?"} <span aria-hidden="true">→</span></button>
        </div>
        <p className="plugin-line">Free. Public checks run on any site. Database and file checks run only for the verified owner. Nothing is saved.</p>
      </form>

      {error && <p className="leak-error" role="alert">{error}</p>}

      {report && verdict && (
        <section className="safe-result" aria-live="polite">
          <div className={`safe-verdict ${verdict.className}`}>
            <p className="section-kicker">{report.host}{report.partial ? " · partial" : ""}</p>
            <h2>{verdict.label}</h2>
            <p>{verdict.line}</p>
            <p className="safe-counts"><span>{report.summary.fail} critical</span><span>{report.summary.warn} to improve</span><span>{report.summary.pass} passed</span></p>
          </div>

          <ol className="safe-findings">
            {report.findings.map(finding => (
              <li key={finding.id} className={`is-${finding.status}`}>
                <span className="safe-area">{AREA_NAMES[finding.area]}</span>
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
                {finding.fix && <p className="safe-fix">{finding.fix}</p>}
              </li>
            ))}
          </ol>

          {!report.owner.verified && (
            <div className="safe-verify">
              <strong>Test your database and source files</strong>
              <p>{report.supabase ? `Your site uses the Supabase project ${report.supabase}. ` : ""}Prove you own {report.host}: publish this file, or add the meta tag to your homepage, redeploy, then run the check again.</p>
              <p className="safe-code"><code>{report.owner.file}</code> containing <code>{report.owner.token}</code></p>
              <div className="action-buttons">
                <CopyTextButton text={report.owner.token} label="Copy the file content" copiedLabel="Copied" />
                <CopyTextButton text={report.owner.meta} label="Copy the meta tag" copiedLabel="Copied" />
                <button type="button" className="cta-button" onClick={() => run()} disabled={busy}>{busy ? "Checking…" : "I added it, check again"}</button>
              </div>
              <p className="plugin-line">In Next.js put the file in public/.well-known/. In Lovable or Bolt, ask: &quot;add a file at public/.well-known/deploydoctor.txt with this content&quot;.</p>
            </div>
          )}

          {report.verdict === "not-safe" && <p>Want the code side fixed? <Link href="/#scan-repository">Scan the repo</Link> for the file and line, or follow <Link href="/launch-manual">the launch manual</Link>.</p>}
          {share && <p><a className="cta-button" href={share} target="_blank" rel="noopener noreferrer">Share the result on X</a></p>}
        </section>
      )}
    </div>
  );
}
