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
      const data = await response.json() as { url?: string; error?: string; refunded?: boolean };
      if (data.refunded) { setOutcome(data.error || "Refunded."); setBusy(false); return; }
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

  async function checkBuild(action: "build") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fix/outcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action }) });
      const data = await response.json() as { refunded?: boolean; outcome?: string; prUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error || "The build could not be checked.");
      if (data.prUrl) setUrl(data.prUrl);
      setOutcome(data.refunded ? "Refunded. Vercel did not build the fix commit, so the charge comes back." : data.outcome === "pending" ? "Vercel has not reported a result for the fix commit yet. Check again after the deployment finishes." : `Vercel build: ${data.outcome ?? "unknown"}.`);
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
      <p className="form-note">If the pull request cannot be opened, the $5 is refunded automatically. Paid orders without a pull request are also refunded within a day.</p>
      {url && <p><a href={url}>{url}</a></p>}
      {patch && <pre><code>{patch}</code></pre>}
      {outcome && <p role="status">{outcome}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
