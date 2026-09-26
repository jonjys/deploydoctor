"use client";

import { useState } from "react";

export function CopyFixesButton({ instructions }: { instructions: string }) {
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
      {copied ? "Copied" : "Copy free"}
    </button>{failed && <textarea aria-label="Select and copy free instructions" readOnly value={instructions} />}</div>
  );
}
