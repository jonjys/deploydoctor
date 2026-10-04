"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { describeStack, type Stack } from "@/lib/stack";
import { useLang, useT } from "@/components/lang";
import type { Category } from "@/types/report";

const GITHUB_REPO_URL = /^https:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i;
const FALLBACK_CHECKS: Category[] = ["next", "vercel", "env"];
type Detection = { status: "loading" } | { status: "ready"; stack: Stack } | { status: "error" };
const STEP_KEYS = ["form.step.tree", "form.step.stack", "form.step.checks", "form.step.report"] as const;

/** ?repo=owner/name or a full GitHub URL, so a shared link can start a scan on arrival. */
function repoUrlFromParam(value: string | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const url = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) ? `https://github.com/${trimmed}` : trimmed;
  return GITHUB_REPO_URL.test(url) ? url : "";
}

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
  const lang = useLang();
  const t = useT();
  const autoRepoUrl = repoUrlFromParam(useSearchParams().get("repo"));
  const [repoUrl, setRepoUrl] = useState(autoRepoUrl);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [paywall, setPaywall] = useState(false);
  const [privateToken, setPrivateToken] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const tokenRef = useRef("");

  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort(); }, []);

  // "/" focuses the repository field from anywhere on the page, unless you are already typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // While a scan runs, walk through the stages the server goes through. The last stage waits for the response.
  useEffect(() => {
    if (!isLoading) return;
    const handle = window.setInterval(() => setStep((current) => Math.min(current + 1, STEP_KEYS.length - 1)), 2_300);
    return () => window.clearInterval(handle);
  }, [isLoading]);

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
      const payload = (await response.json()) as { stack?: Stack; checks?: Category[] };
      if (!response.ok || !payload.stack || !payload.checks) throw new Error("detect failed");
      setSelected(new Set(payload.checks));
      setDetection({ status: "ready", stack: payload.stack });
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
    // Send the visible selection; while detection is still running the server picks the categories itself.
    const sendChecks = detection?.status === "ready" || detection?.status === "error";
    if (sendChecks && selected.size === 0) {
      setError(t("form.pickOne"));
      return;
    }
    await startScan(repoUrl, sendChecks);
  }

  async function startScan(url: string, sendChecks: boolean) {
    setError("");
    setPaywall(false);
    cancelDetection();
    setStep(0);
    setIsLoading(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: url,
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
        throw new Error(payload.error || t("form.scanFailed"));
      }

      router.push(`/r/${payload.id}`);
      setPrivateToken("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("form.scanFailed"),
      );
      setIsLoading(false);
    }
  }

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoRepoUrl || autoStarted.current) return;
    autoStarted.current = true;
    const handle = window.setTimeout(() => void startScan(autoRepoUrl, false), 0);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRepoUrl]);

  return (
    <form className="repo-form" onSubmit={handleSubmit}>
      <div className="input-shell">
        <GitHubIcon />
        <label className="sr-only" htmlFor="repo-url">
          {t("form.urlLabel")}
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
          ref={inputRef}
          required
        />
        <kbd className="slash-hint" aria-hidden="true" title={t("form.shortcut")}>/</kbd>
        <button className="scan-button" type="submit" disabled={isLoading}>
          {isLoading ? t("form.scanning") : t("form.scan")}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {isLoading && (
        <ol className="scan-progress" aria-live="polite">
          {STEP_KEYS.map((key, index) => (
            <li key={key} className={index < step ? "is-done" : index === step ? "is-active" : ""}>
              <span className="step-mark" aria-hidden="true">{index < step ? "✓" : ""}</span>
              {t(key)}
            </li>
          ))}
        </ol>
      )}
      {detection && !isLoading && (
        <fieldset className="stack-panel" disabled={isLoading}>
          <legend className="sr-only">{t("form.whatToScan")}</legend>
          <p className="stack-summary" aria-live="polite">
            {detection.status === "loading" ? t("form.detecting")
              : detection.status === "ready" ? <>{t("form.detected")} <strong>{describeStack(detection.stack, lang)}</strong></>
              : t("form.detectFailed")}
          </p>
          {detection.status !== "loading" && (
            <div className="check-options">
              {CATEGORIES.map((category) => (
                <label key={category}>
                  <input type="checkbox" checked={selected.has(category)} onChange={() => toggle(category)} />
                  {t(`catopt.${category}`)}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {privateAccess && <details className="private-input"><summary>{t("form.private.summary")}</summary>
        <label htmlFor="private-token">{t("form.private.label")}</label>
        <input id="private-token" type="password" autoComplete="off" value={privateToken} onChange={(event) => { setPrivateToken(event.target.value); tokenRef.current = event.target.value.trim(); }} />
        <p>{t("form.private.note")}</p>
      </details>}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {paywall && <div className="paywall" role="status"><strong>{t("paywall.title")}</strong>
        <p>{t("paywall.body")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
          <Link className="cta-button" href="/checkout?plan=day">{t("paywall.day")}</Link>
          <Link className="cta-button" style={{ background: "transparent" }} href="/checkout?plan=week">{t("paywall.week")}</Link>
          <Link className="cta-button" style={{ background: "transparent" }} href="/pricing">{t("paywall.cta")}</Link>
        </div>
      </div>}
    </form>
  );
}
