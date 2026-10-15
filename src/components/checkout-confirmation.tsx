"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang";
import { loadDiagnosis } from "@/lib/saved-diagnosis";

export function CheckoutConfirmation({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [message, setMessage] = useState(t("confirm.waiting"));
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [needsRestore, setNeedsRestore] = useState(false);
  const [repo, setRepo] = useState("");
  const [diagnosis, setDiagnosis] = useState<"" | "result" | "log">("");
  useEffect(() => {
    let canceled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function confirm(count = 0) {
      try {
        const response = await fetch("/api/stripe/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }), signal: controller.signal });
        const result = await response.json();
        if (canceled) return;
        if (!response.ok) { setMessage(result.error); setNeedsRestore(response.status === 403); return; }
        if (result.pending) {
          setMessage(t("confirm.pending"));
          if (count < 8) timer = setTimeout(() => confirm(count + 1), 2500);
        } else {
          setReady(true); setMessage(result.repair ? t("confirm.repair") : t("confirm.done"));
          if (!result.repair && typeof result.repo === "string") setRepo(result.repo);
          // Bought from the rescue offer or the paywall of the diagnose page: it shows the diagnosis or the stopped log again.
          else if (!result.repair) { const saved = loadDiagnosis(); setDiagnosis(!saved ? "" : saved.diagnosis ? "result" : "log"); }
        }
      } catch { if (!canceled) setMessage(t("confirm.failed")); }
    }
    void confirm();
    return () => { canceled = true; controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t only changes with the language
  }, [sessionId, attempt]);
  return <><p role="status">{message}</p>{needsRestore && <p><Link href="/restore">{t("confirm.restoreLink")}</Link></p>}<div className="action-buttons">{!ready && <button className="cta-button" onClick={() => setAttempt(attempt + 1)}>{t("confirm.recheck")}</button>}
    {/* Back to the scan the buyer paid for; private=1 opens the token field instead of starting without one. */}
    {ready && repo && <Link className="cta-button" href={`/?repo=${repo}&private=1`}>{t("confirm.scanNow", { repo })} →</Link>}
    {ready && diagnosis && <Link className="cta-button" href="/diagnose">{t(diagnosis === "result" ? "confirm.backToDiagnosis" : "confirm.diagnoseLog")} →</Link>}
    <Link className="cta-button" style={ready && (repo || diagnosis) ? { background: "transparent" } : undefined} href="/account">{t("nav.myScans")} →</Link></div></>;
}
