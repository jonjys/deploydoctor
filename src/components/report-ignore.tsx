"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { countStatuses, overallLabel, overallOf } from "@/lib/report-summary";
import { joinFixParts, type freeFixParts } from "@/lib/fix-instructions";
import { CopyFixesButton as CopyButton } from "@/components/copy-fixes-button";
import { useLang, useT } from "@/components/lang";
import type { CheckStatus } from "@/types/report";

type IgnoreState = { ignored: ReadonlySet<string>; toggle: (id: string) => void };
const IgnoreContext = createContext<IgnoreState>({ ignored: new Set(), toggle: () => {} });

// Ignoring is a per-browser view preference: the shared report itself is never changed.
export function IgnoreProvider({ reportId, children }: { reportId: string; children: ReactNode }) {
  const storageKey = `deploydoctor:ignored:${reportId}`;
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after mount
      if (Array.isArray(saved)) setIgnored(new Set(saved.filter((item): item is string => typeof item === "string")));
    } catch { /* storage can be unavailable or hold bad data */ }
  }, [storageKey]);

  const toggle = useCallback((id: string) => {
    setIgnored((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { window.localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* keep in memory */ }
      return next;
    });
  }, [storageKey]);

  const value = useMemo(() => ({ ignored, toggle }), [ignored, toggle]);
  return <IgnoreContext value={value}>{children}</IgnoreContext>;
}

export function ScoreCard({ checks, notNext = false }: { checks: Array<{ id: string; status: CheckStatus }>; notNext?: boolean }) {
  const { ignored } = useContext(IgnoreContext);
  const lang = useLang();
  const t = useT();
  const summary = countStatuses(checks.filter((check) => !ignored.has(check.id)));
  return (
    <div className={`score-card is-${notNext ? "neutral" : overallOf(summary)}`}>
      <span>{t("report.overall")}</span>
      <strong>{overallLabel(summary, lang, { notNext })}</strong>
    </div>
  );
}

export function IssueCard({ id, title, status, symbol, label, children }: {
  id: string; title: string; status: CheckStatus; symbol: string; label: string; children: ReactNode;
}) {
  const { ignored, toggle } = useContext(IgnoreContext);
  const t = useT();
  if (status !== "green" && ignored.has(id)) {
    return (
      <article className="result-card is-ignored">
        <div className="result-body">
          <p>{t("report.ignoredTitle", { title })} <button className="ignore-button" type="button" onClick={() => toggle(id)}>{t("report.undo")}</button></p>
        </div>
      </article>
    );
  }
  return (
    <article className={`result-card is-${status}`}>
      <div className="result-status">
        <span className="status-symbol" aria-hidden="true">{symbol}</span>
        {label}
      </div>
      <div className="result-body">
        {children}
        {status !== "green" && <button className="ignore-button" type="button" onClick={() => toggle(id)}>{t("report.ignore")}</button>}
      </div>
    </article>
  );
}

export function WhenOpenRed({ checks, children }: { checks: Array<{ id: string; status: CheckStatus }>; children: ReactNode }) {
  const { ignored } = useContext(IgnoreContext);
  return checks.some((check) => check.status === "red" && !ignored.has(check.id)) ? <>{children}</> : null;
}

export function CopyFixes({ parts }: { parts: ReturnType<typeof freeFixParts> }) {
  const { ignored } = useContext(IgnoreContext);
  return <CopyButton instructions={joinFixParts(parts, ignored)} />;
}
