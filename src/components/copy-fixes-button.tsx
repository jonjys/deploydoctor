"use client";

import { useState } from "react";
import { useT } from "@/components/lang";

/** Copies the free instructions, or with `file` a complete file shown on the report. */
export function CopyFixesButton({ instructions, file = false }: { instructions: string; file?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(instructions);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { setFailed(true); }
  }

  return (
    <div><button className={file ? "copy-button file-copy-button" : "copy-button"} type="button" onClick={copyInstructions}>
      {copied ? t("report.copied") : t(file ? "report.copyFile" : "report.copy")}
    </button>{failed && <textarea aria-label={t(file ? "report.copyFileAria" : "report.copyAria")} readOnly value={instructions} />}</div>
  );
}
