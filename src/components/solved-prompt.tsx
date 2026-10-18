"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang";
import { recentRepositories, type RecentScan } from "@/lib/recent-scans";

type Kind = "report" | "diagnosis";
type Recent = RecentScan;

const RECENT_KEY = "dd-recent-reports";
const ANSWERS_KEY = "dd-solved";

// Browser storage can be missing or blocked; every read and write falls back quietly.
function read<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? "null") as T | null) ?? fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not stored, still works */ }
}

/** Did DeployDoctor solve it? Shown under a report and under a diagnosis; answering again replaces the answer. */
export function SolvedPrompt({ kind, target, repo }: { kind: Kind; target: string; repo?: string }) {
  const t = useT();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = read<Record<string, boolean>>(ANSWERS_KEY, {})[target];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored answer only exists in the browser
    if (typeof saved === "boolean") setAnswer(saved);
    if (kind === "report" && repo) {
      const recent = recentRepositories(read<unknown>(RECENT_KEY, []), Date.now(), 5).filter((item) => item.id !== target);
      write(RECENT_KEY, [{ id: target, repo, at: Date.now() }, ...recent].slice(0, 5));
    }
  }, [kind, target, repo]);

  async function send(solved: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, target, solved }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || t("solved.failed"));
      write(ANSWERS_KEY, { ...read<Record<string, boolean>>(ANSWERS_KEY, {}), [target]: solved });
      setAnswer(solved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("solved.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="solved-prompt" id="solved" aria-labelledby={`solved-${target}`}>
      <h2 id={`solved-${target}`}>{t("solved.title")}</h2>
      {answer === null ? (
        <>
          <p>{kind === "report" ? t("solved.bodyReport") : t("solved.bodyDiagnosis")}</p>
          <div className="solved-actions">
            <button className="cta-button" type="button" disabled={busy} onClick={() => send(true)}>{t("solved.yes")}</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => send(false)}>{t("solved.no")}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      ) : (
        <p role="status">
          {answer ? t("solved.thanksYes") : kind === "report" ? t("solved.thanksNo") : t("solved.thanksNoDiagnosis")}
          {!answer && kind === "report" && <> <Link href="/diagnose">{t("nav.diagnose")} →</Link></>}
          {" "}<button className="link-button" type="button" onClick={() => setAnswer(null)}>{t("solved.change")}</button>
        </p>
      )}
    </section>
  );
}

/** Return to the latest opened report per repository, even after confirming a fix. */
export function RecentScans() {
  const t = useT();
  const [open, setOpen] = useState<Recent[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list only exists in the browser
    setOpen(recentRepositories(read<unknown>(RECENT_KEY, [])));
  }, []);
  if (!open.length) return null;
  return (
    <div className="recent-scans" role="region" aria-label={t("solved.recentTitle")}>
      <h2>{t("solved.recentTitle")}</h2>
      <p className="recent-scans-note">{t("solved.recentNote")}</p>
      <ul>
        {open.map((item) => (
          <li key={item.id}>
            <span>{item.repo.replace(/^https:\/\/github\.com\//, "")}</span>
            <div className="recent-scan-actions">
              <Link href={`/r/${item.id}#since-last-scan`}>{t("solved.recentOpen")} →</Link>
              <Link href={`/?repo=${encodeURIComponent(item.repo)}`}>{t("solved.recentRescan")} ↻</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
