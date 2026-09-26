"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPaywall(false);
    setIsLoading(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, ...(privateToken ? { privateToken } : {}) }),
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
          onChange={(event) => setRepoUrl(event.target.value)}
          required
        />
        <button className="scan-button" type="submit" disabled={isLoading}>
          {isLoading ? "Scanning…" : "Scan repository"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {privateAccess && <details className="private-input"><summary>Skanna ett privat repo</summary>
        <label htmlFor="private-token">GitHub-token för just det här repot (Contents: read)</label>
        <input id="private-token" type="password" autoComplete="off" value={privateToken} onChange={(event) => setPrivateToken(event.target.value)} />
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
