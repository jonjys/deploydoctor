"use client";
import { useT } from "@/components/lang";
import { CopyTextButton } from "@/components/copy-text-button";

export function PatchRecoveryKey({ recoveryKey, sessionId }: { recoveryKey: string; sessionId?: string }) {
  const t = useT();
  const details = sessionId ? `Payment reference: ${sessionId}\nRecovery key: ${recoveryKey}` : recoveryKey;
  return <details className="patch-recovery" open>
    <summary>{t("patch.recovery.title")}</summary>
    <p>{t("patch.recovery.body")}</p>
    {sessionId && <p>{t("restore.session")}: <code>{sessionId}</code></p>}
    <label>{t("patch.recovery.key")}<input className="patch-key" readOnly value={recoveryKey} aria-label={t("patch.recovery.key")} /></label>
    <CopyTextButton text={details} label={t("patch.recovery.copy")} copiedLabel={t("report.copied")} />
  </details>;
}
