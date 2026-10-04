"use client";

import { useState } from "react";

/** Copies a short piece of text, such as a badge snippet, with labels supplied by the caller. */
export function CopyTextButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { setFailed(true); }
  }

  return (
    <span className="copy-text">
      <button className="copy-button file-copy-button" type="button" onClick={copy}>{copied ? copiedLabel : label}</button>
      {failed && <textarea aria-label={label} readOnly value={text} />}
    </span>
  );
}
