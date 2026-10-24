"use client";
import { useRef, useState, type FormEvent } from "react";
import { useLang } from "@/components/lang";

/** The credential exists only in this form and the one HTTPS request. Never local/session storage. */
export function PatchPullRequest({ sessionId, repoUrl }: { sessionId: string; repoUrl: string }) {
  const sv = useLang() === "sv";
  const token = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [state, setState] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const githubToken = token.current?.value.trim() ?? "";
    if (token.current) token.current.value = "";
    try {
      const response = await fetch("/api/patch/pull-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, githubToken, consent: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Please try again.");
      const target = new URL(result.url);
      if (target.origin !== "https://github.com" || !target.href.toLowerCase().startsWith(`${repoUrl.toLowerCase()}/pull/`) || !/^\d+$/.test(target.pathname.split("/").pop() ?? "")) throw new Error("Unexpected pull request link.");
      setUrl(target.href); setState(result.state);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="patch-pr" aria-labelledby="patch-pr-title">
    <p className="section-kicker">{sv ? "FRÅN VERIFIERAD PATCH TILL PR" : "FROM VERIFIED PATCH TO PR"}</p>
    <h2 id="patch-pr-title">{sv ? "Granska fixen i GitHub" : "Review the fix in GitHub"}</h2>
    <p>{sv ? "Öppna patchen som en draft-PR i samma publika repo. Standardgrenen måste fortfarande vara på den skannade committen. Du granskar, testar och mergar själv." : "Open your patch as a draft PR in the same public repository. Its default branch must still match the scanned commit. You review, test and merge it yourself."}</p>
    {url ? <p role="status"><a className="cta-button" href={url} target="_blank" rel="noopener noreferrer">{sv ? "Öppna pull request" : "Open pull request"} ↗</a> {state === "closed" && (sv ? "Denna PR är redan stängd. Ingen ny skapas." : "This PR is already closed. No duplicate was created.")}</p> : <details><summary>{sv ? "Öppna en draft-PR med min GitHub-token" : "Open a draft PR with my GitHub token"}</summary>
      <p>{sv ? "Skapa en tillfällig fine-grained token för endast detta repo, med Contents: Read and write och Pull requests: Read and write. Tokenen används för detta anrop och sparas aldrig." : "Create a temporary fine-grained token for this repository only, with Contents: Read and write and Pull requests: Read and write. The token is used for this request and never stored."} <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub ↗</a></p>
      <form onSubmit={event => void submit(event)}><label htmlFor="patch-pr-token">GitHub token</label><input ref={token} id="patch-pr-token" className="repo-input" type="password" autoComplete="off" spellCheck={false} required minLength={20} maxLength={300} />
        <button className="cta-button" type="submit" disabled={busy}>{busy ? (sv ? "Verifierar och öppnar…" : "Verifying and opening…") : (sv ? "Skapa draft-PR" : "Create draft PR")}</button></form>
    </details>}
    {error && <p role="alert" className="patch-error">{error}</p>}
  </section>;
}
