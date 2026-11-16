"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RepoSafetyReport, Severity } from "@/lib/repo-safety";

const VERDICT = {
  "red-flags": { className: "is-bad", line: "Do not download or run it until you have read the lines below." },
  check: { className: "is-mid", line: "Nothing alarming in the code, but read these before you run it." },
  "no-red-flags": { className: "is-good", line: "No suspicious patterns in the files we read. That is not a guarantee: read what you run." },
} as const;
const STATUS: Record<Severity, string> = { high: "fail", medium: "warn", low: "info", info: "pass" };
const LABEL: Record<Severity, string> = { high: "Red flag", medium: "Read this", low: "Worth knowing", info: "Fact" };

export function RepoSafetyForm({ initial }: { initial: string }) {
  const [repo, setRepo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RepoSafetyReport | null>(null);
  const started = useRef(false);

  async function run(value = repo) {
    setBusy(true); setError(null); setReport(null);
    try {
      const response = await fetch("/api/repo-safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: value }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "The check could not finish.");
      else {
        setReport(body as RepoSafetyReport);
        try { window.history.replaceState(null, "", `/is-this-repo-safe?repo=${encodeURIComponent((body as RepoSafetyReport).repo)}`); } catch { /* ignore */ }
      }
    } catch { setError("The check could not finish. Check your connection."); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (initial && !started.current) { started.current = true; void run(initial); } }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const verdict = report ? VERDICT[report.verdict] : null;
  const share = report ? `https://x.com/intent/tweet?text=${encodeURIComponent(`Checked ${report.repo} before running it: ${report.headline.toLowerCase()}.\n\nCheck a GitHub repo before you download it:`)}&url=${encodeURIComponent(`https://deploydoctor.nyttolabs.com/is-this-repo-safe?repo=${report.repo}`)}` : null;

  return (
    <div className="safe-check">
      <form className="repo-form" onSubmit={event => { event.preventDefault(); void run(); }}>
        <div className="input-shell">
          <span aria-hidden="true" className="leak-icon">🛡️</span>
          <label className="sr-only" htmlFor="repo-safety-url">GitHub repository</label>
          <input className="repo-input" id="repo-safety-url" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="github.com/owner/repo" value={repo} onChange={event => setRepo(event.target.value)} required />
          <button className="scan-button" type="submit" disabled={busy}>{busy ? "Reading the code…" : "Is it safe?"} <span aria-hidden="true">→</span></button>
        </div>
        <p className="plugin-line">Free. Public repositories. Nothing is downloaded to your computer and nothing is run: we read the files.</p>
      </form>

      {error && <p className="leak-error" role="alert">{error}</p>}

      {report && verdict && (
        <section className="safe-result" aria-live="polite">
          <div className={`safe-verdict ${verdict.className}`}>
            <p className="section-kicker">{report.repo} · {report.filesRead} of {report.filesInRepo} files read{report.partial ? " · partial" : ""}</p>
            <h2>{report.headline}</h2>
            <p>{verdict.line}</p>
          </div>
          {report.findings.length > 0 && (
            <ol className="safe-findings">
              {report.findings.map(f => (
                <li key={f.id} className={`is-${STATUS[f.severity]}`}>
                  <span className="safe-area">{LABEL[f.severity]}{f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ""}` : ""}</span>
                  <strong>{f.title}</strong>
                  <p>{f.detail}</p>
                  {f.excerpt && <pre className="repo-safety-excerpt"><code>{f.excerpt}</code></pre>}
                </li>
              ))}
            </ol>
          )}
          <p className="plugin-line">A static check reads code for known tricks. It cannot prove a program is safe, and new tricks appear every week. If in doubt, run it in a virtual machine or not at all.</p>
          {share && <p><a className="cta-button" href={share} target="_blank" rel="noopener noreferrer">Share this check on X</a></p>}
          <p>Building your own app? <Link href="/#scan-repository">Scan it before you deploy</Link>.</p>
        </section>
      )}
    </div>
  );
}
