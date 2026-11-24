"use client";

import { useEffect, useRef, useState } from "react";
import type { RepoSafetyReport } from "@/lib/repo-safety";
import type { DependencyReport, DependencyTeaser } from "@/lib/dependency-safety";
import { RepoSafetyResult } from "./repo-safety-result";

export function RepoSafetyForm({ initial, autorun = true }: { initial: string; autorun?: boolean }) {
  const [repo, setRepo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<(RepoSafetyReport & { dependencies?: DependencyReport | DependencyTeaser | null }) | null>(null);
  const started = useRef(false);

  async function run(value = repo) {
    setBusy(true); setError(null); setReport(null);
    try {
      const response = await fetch("/api/repo-safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: value }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "The check could not finish.");
      else {
        setReport(body as RepoSafetyReport & { dependencies?: DependencyReport | DependencyTeaser | null });
        // Each repository has its own page, so the address can be shared and the stored result loads there next time.
        try { window.history.replaceState(null, "", `/is-this-repo-safe/${(body as RepoSafetyReport).repo}`); } catch { /* ignore */ }
      }
    } catch { setError("The check could not finish. Check your connection."); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (autorun && initial && !started.current) { started.current = true; void run(initial); } }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {report && <RepoSafetyResult report={report} dependencies={report.dependencies} />}
    </div>
  );
}
