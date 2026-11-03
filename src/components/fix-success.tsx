"use client";

import { useState } from "react";

export function FixSuccess({ sessionId }: { sessionId: string }) {
  const [url, setUrl] = useState("");
  const [patch, setPatch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");

  async function openPullRequest() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fix/pull-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "The pull request could not be opened.");
      setUrl(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pull request could not be opened.");
    }
    setBusy(false);
  }

  async function loadDiff() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fix/diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await response.json() as { patch?: string; error?: string };
      if (!response.ok || !data.patch) throw new Error(data.error || "The diff is not released.");
      setPatch(data.patch);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The diff is not released.");
    }
    setBusy(false);
  }

  async function checkBuild(action: "build" | "missing") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fix/outcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action }) });
      const data = await response.json() as { refunded?: boolean; outcome?: string; prUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error || "The build could not be checked.");
      if (data.prUrl) setUrl(data.prUrl);
      setOutcome(data.refunded ? "Refunded. The build did not pass, so the charge comes back." : `Build status: ${data.outcome ?? "unknown"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The build could not be checked.");
    }
    setBusy(false);
  }

  return (
    <div className="diag-actions">
      <button className="cta-button" type="button" disabled={busy} onClick={openPullRequest}>Open the pull request</button>
      <button className="cta-button" type="button" disabled={busy} onClick={loadDiff}>Show the patch</button>
      <button type="button" disabled={busy} onClick={() => checkBuild("build")}>Build failed? Refund me</button>
      <button type="button" disabled={busy} onClick={() => checkBuild("missing")}>No pull request was opened</button>
      {url && <p><a href={url}>{url}</a></p>}
      {patch && <pre><code>{patch}</code></pre>}
      {outcome && <p role="status">{outcome}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
