"use client";

import { useState } from "react";

export function CopyFixesButton({ instructions }: { instructions: string }) {
  const [copied, setCopied] = useState(false);

  async function copyInstructions() {
    await navigator.clipboard.writeText(instructions);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <button className="copy-button" type="button" onClick={copyInstructions}>
      {copied ? "Copied" : "Copy fix instructions"}
    </button>
  );
}
