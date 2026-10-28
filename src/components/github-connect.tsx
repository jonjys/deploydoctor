"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/lang";

type Status = { configured: boolean; paid: boolean; connected: boolean; login: string | null; installUrl: string | null };
export function GitHubConnect({ repoUrl, onSelect }: { repoUrl: string; onSelect: (repo: string) => void }) {
  const sv = useLang() === "sv";
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { const updated = () => setRevision(r => r + 1); window.addEventListener("dd-github-updated", updated); return () => window.removeEventListener("dd-github-updated", updated); }, []);
  const [repos, setRepos] = useState<{ name: string }[] | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/github/status", { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); setStatus(await r.json()); }).catch(() => { if (!controller.signal.aborted) setError(sv ? "GitHub-anslutningen kunde inte hämtas." : "Could not load the GitHub connection."); });
    return () => controller.abort();
  }, [sv, revision]);
  async function list() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/github/repositories"); const data = await response.json(); if (!response.ok) throw new Error(); setRepos(data.repositories); }
    catch { setError(sv ? "Kunde inte lista repon. Anslut igen eller kontrollera vilka repon du valt på GitHub." : "Could not list repositories. Reconnect or check the repositories selected on GitHub."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    const response = await fetch("/api/github/disconnect", { method: "POST" });
    if (!response.ok) { setError(sv ? "Kunde inte koppla från." : "Could not disconnect."); return; }
    setStatus(value => value ? { ...value, connected: false, login: null } : null); setRepos(null);
  }
  const href = "/api/github/connect?repo=" + encodeURIComponent(repoUrl);
  return <div className="github-connect">
    {!status && !error && <p>{sv ? "Kontrollerar GitHub-anslutning…" : "Checking GitHub connection…"}</p>}
    {status && !status.configured && !status.connected && <p role="status">{sv ? "GitHub-anslutningen behöver aktiveras en gång av DeployDoctors ägare. Du ska inte behöva skapa en personlig token. Ditt pass gäller fortfarande." : "GitHub connection needs one-time activation by the DeployDoctor owner. You should not need a personal token. Your pass remains valid."}</p>}
    {status && (status.configured || status.connected) && <>
      <p>{status.connected ? (sv ? `Ansluten som ${status.login}.` : `Connected as ${status.login}.`) : (sv ? "Anslut GitHub och välj vilka repon DeployDoctor får läsa. Inga personliga tokens att skapa." : "Connect GitHub and choose which repositories DeployDoctor may read. No personal tokens to create.")}</p>
      <div className="github-connect-actions">{status.configured && <a className="cta-button" href={href}>{status.connected ? (sv ? "Anslut GitHub igen" : "Reconnect GitHub") : (sv ? "Anslut GitHub" : "Connect GitHub")}</a>}
        {status.connected && <button type="button" onClick={list} disabled={busy}>{sv ? "Välj privat repo" : "Choose private repository"}</button>}
        {status.installUrl && <a href={status.installUrl + "?repo=" + encodeURIComponent(repoUrl)}>{sv ? "Välj tillåtna repon på GitHub" : "Select allowed repositories on GitHub"} ↗</a>}
      </div>
      {repos && <label>{sv ? "Privata repon som anslutningen kan läsa" : "Private repositories this connection can read"}<select value="" onChange={event => { if (event.target.value) onSelect("https://github.com/" + event.target.value); }}><option value="">{sv ? "Välj repo" : "Choose repository"}</option>{repos.map(repo => <option key={repo.name} value={repo.name}>{repo.name}</option>)}</select></label>}
      {repos?.length === 0 && <p>{sv ? "Inga privata repon hittades. Välj tillåtna repon på GitHub, kom tillbaka och anslut igen. Du kan också klistra in repo-länken direkt." : "No private repositories found. Select allowed repositories on GitHub, return and reconnect. You can also paste the repository link directly."}</p>}
      {status.connected && <button type="button" onClick={disconnect}>{sv ? "Koppla från denna webbläsare" : "Disconnect this browser"}</button>}
      <p>{sv ? "Anslutningen får bara läsa. Behörighet och aktivt pass kontrolleras vid skanning. Privata rapporter förblir privata." : "The connection is read-only. Repository access and your active pass are checked when scanning. Private reports remain private."}</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
