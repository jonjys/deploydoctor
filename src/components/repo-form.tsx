"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CATEGORIES, CATEGORY_OPTION_LABELS } from "@/lib/categories";
import type { Category } from "@/types/report";

const GITHUB_REPO_URL = /^https:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i;
const FALLBACK_CHECKS: Category[] = ["next", "vercel", "env"];
type Detection = { status: "loading" } | { status: "ready"; summary: string } | { status: "error" };

function GitHubIcon() {
  return (
    <svg className="github-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 0 1 1.2-3.2c-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.2 11.2 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2a4.7 4.7 0 0 1 1.2 3.2c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.4 11.4 0 0 0 12 .8Z"
      />
    </svg>
  );
}

export function RepoForm({ privateAccess = false }: { privateAccess?: boolean }) {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [privateToken, setPrivateToken] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const tokenRef = useRef("");

  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort(); }, []);

  function cancelDetection() {
    window.clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
  }

  async function detectStack(url: string) {
    const current = new AbortController();
    controller.current = current;
    setDetection({ status: "loading" });
    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url, ...(tokenRef.current ? { privateToken: tokenRef.current } : {}) }),
        signal: current.signal,
      });
      const payload = (await response.json()) as { summary?: string; checks?: Category[] };
      if (!response.ok || !payload.summary || !payload.checks) throw new Error("detect failed");
      setSelected(new Set(payload.checks));
      setDetection({ status: "ready", summary: payload.summary });
    } catch {
      if (current.signal.aborted) return;
      setSelected(new Set(FALLBACK_CHECKS));
      setDetection({ status: "error" });
    }
  }

  function handleUrlChange(value: string) {
    setRepoUrl(value);
    cancelDetection();
    setDetection(null);
    if (GITHUB_REPO_URL.test(value.trim())) {
      timer.current = window.setTimeout(() => void detectStack(value.trim()), 500);
    }
  }

  function toggle(category: Category) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPaywall(false);
    // Send the visible selection; while detection is still running the server picks the categories itself.
    const sendChecks = detection?.status === "ready" || detection?.status === "error";
    if (sendChecks && selected.size === 0) {
      setError("Välj minst en kategori att skanna.");
      return;
    }
    cancelDetection();
    setIsLoading(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl,
          ...(sendChecks ? { checks: CATEGORIES.filter((category) => selected.has(category)) } : {}),
          ...(privateToken ? { privateToken } : {}),
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        error?: string;
        paywall?: boolean;
      };

      if (!response.ok || !payload.id) {
        setPaywall(Boolean(payload.paywall));
        throw new Error(payload.error || "The scan could not be completed.");
      }

      router.push(`/r/${payload.id}`);
      setPrivateToken("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The scan could not be completed.",
      );
      setIsLoading(false);
    }
  }

  return (
    <form className="repo-form" onSubmit={handleSubmit}>
      <div className="input-shell">
        <GitHubIcon />
        <label className="sr-only" htmlFor="repo-url">
          Public GitHub repository URL
        </label>
        <input
          className="repo-input"
          id="repo-url"
          name="repoUrl"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={(event) => handleUrlChange(event.target.value)}
          required
        />
        <button className="scan-button" type="submit" disabled={isLoading}>
          {isLoading ? "Scanning…" : "Scan repository"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {detection && (
        <fieldset className="stack-panel" disabled={isLoading}>
          <legend className="sr-only">Vad ska skannas</legend>
          <p className="stack-summary" aria-live="polite">
            {detection.status === "loading" ? "Detecting stack…"
              : detection.status === "ready" ? <>Stack detected: <strong>{detection.summary}</strong></>
              : "Kunde inte läsa stacken automatiskt. Välj vad som ska skannas:"}
          </p>
          {detection.status !== "loading" && (
            <div className="check-options">
              {CATEGORIES.map((category) => (
                <label key={category}>
                  <input type="checkbox" checked={selected.has(category)} onChange={() => toggle(category)} />
                  {CATEGORY_OPTION_LABELS[category]}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {privateAccess && <details className="private-input"><summary>Skanna ett privat repo</summary>
        <label htmlFor="private-token">GitHub-token för just det här repot (Contents: read)</label>
        <input id="private-token" type="password" autoComplete="off" value={privateToken} onChange={(event) => { setPrivateToken(event.target.value); tokenRef.current = event.target.value.trim(); }} />
        <p>Nyckeln används bara för denna skanning och sparas aldrig. Privata rapporter kan bara läsas i din betalningssession.</p>
      </details>}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {paywall && <div className="paywall" role="status"><strong>Fortsätt från $5</strong>
        <p>7 dagar med obegränsade publika skanningar, eller vänta tills gränsen återställs vid midnatt UTC.</p>
        <Link className="cta-button" href="/pricing">Se priser →</Link>
      </div>}
    </form>
  );
}
