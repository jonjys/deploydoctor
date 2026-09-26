"use client";

import { useState } from "react";
import { useT } from "@/components/lang";

export function CopyFixesButton({ instructions }: { instructions: string }) {
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
    <div><button className="copy-button" type="button" onClick={copyInstructions}>
      {copied ? t("report.copied") : t("report.copy")}
    </button>{failed && <textarea aria-label={t("report.copyAria")} readOnly value={instructions} />}</div>
  );
}
