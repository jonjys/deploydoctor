"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { CATEGORIES } from "@/lib/categories";
import { describeStack, type Stack } from "@/lib/stack";
import { repoUrlFromParam } from "@/lib/repo-input";
import { useLang, useT } from "@/components/lang";
import type { Category } from "@/types/report";

const FALLBACK_CHECKS: Category[] = ["next", "vercel", "env"];
type Detection = { status: "loading" } | { status: "ready"; stack: Stack } | { status: "error"; privateRepo: boolean };
const STEP_KEYS = ["form.step.tree", "form.step.stack", "form.step.checks", "form.step.report"] as const;

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
  const searchParams = useSearchParams();
  const autoRepoUrl = repoUrlFromParam(searchParams.get("repo"));
  // Back from checkout for a private repo: the scan waits for the token instead of starting on arrival.
  const privateStart = searchParams.get("private") === "1";
  const [repoUrl, setRepoUrl] = useState(autoRepoUrl);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [paywall, setPaywall] = useState(false);
  const [privateRepo, setPrivateRepo] = useState(false);
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
    let maybePrivate = false;
    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url, ...(tokenRef.current ? { privateToken: tokenRef.current } : {}) }),
        signal: current.signal,
      });
      const payload = (await response.json()) as { stack?: Stack; checks?: Category[]; privateRepo?: boolean };
      maybePrivate = Boolean(payload.privateRepo);
      if (!response.ok || !payload.stack || !payload.checks) throw new Error("detect failed");
      setSelected(new Set(payload.checks));
      setDetection({ status: "ready", stack: payload.stack });
    } catch {
      if (current.signal.aborted) return;
      setSelected(new Set(FALLBACK_CHECKS));
      setDetection({ status: "error", privateRepo: maybePrivate });
    }
  }

  function handleUrlChange(value: string) {
    setRepoUrl(value);
    cancelDetection();
    setDetection(null);
    const url = repoUrlFromParam(value);
    if (url) {
      timer.current = window.setTimeout(() => void detectStack(url), 500);
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
    // Anything the normalizer cannot read goes as typed, so the server explains what is wrong with it.
    await startScan(repoUrlFromParam(repoUrl) || repoUrl.trim(), sendChecks);
  }

  async function startScan(url: string, sendChecks: boolean) {
    setError("");
    setPaywall(false);
    setPrivateRepo(false);
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
        privateRepo?: boolean;
      };

      if (!response.ok || !payload.id) {
        setPaywall(Boolean(payload.paywall));
        setPrivateRepo(Boolean(payload.privateRepo));
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
    if (!autoRepoUrl || privateStart || autoStarted.current) return;
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
        <div className="repo-input-wrap">
        <input
          className="repo-input"
          id="repo-url"
          name="repoUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={(event) => handleUrlChange(event.target.value)}
          ref={inputRef}
          required
        />
        <kbd className="slash-hint" aria-hidden="true" title={t("form.shortcut")}>/</kbd>
        </div>
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
              : detection.privateRepo ? t("gh.maybePrivate") : t("form.detectFailed")}
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
      {/* Shown to everyone: without a pass, a token scan answers with the $2 offer. */}
      <details className="private-input" open={privateStart}><summary>{t("form.private.summary")}</summary>
        {!privateAccess && <p>{t("form.private.needsPass")}</p>}
        <label htmlFor="private-token">{t("form.private.label")}</label>
        <input id="private-token" type="password" autoComplete="off" value={privateToken} onChange={(event) => { setPrivateToken(event.target.value); tokenRef.current = event.target.value.trim(); }} />
        <p>{t("form.private.note")} <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{t("form.private.tokenLink")}</a></p>
      </details>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {paywall && <div className="paywall" role="status"><strong>{privateRepo ? t("paywall.privateTitle") : t("paywall.title")}</strong>
        {/* The error above already says why; the daily limit text does not apply to a private repo. */}
        {!privateRepo && <p>{t("paywall.body")}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
          <ScanCheckoutButton plan="day" context={repoUrlFromParam(repoUrl) || undefined}>{t("paywall.day")}</ScanCheckoutButton>
          <ScanCheckoutButton plan="week" style={{ background: "transparent" }} context={repoUrlFromParam(repoUrl) || undefined}>{t("paywall.week")}</ScanCheckoutButton>
          <Link className="cta-button" style={{ background: "transparent" }} href="/pricing">{t("paywall.cta")}</Link>
        </div>
      </div>}
    </form>
  );
}
