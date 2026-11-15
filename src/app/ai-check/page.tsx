"use client";

import { useState } from "react";
import Link from "next/link";

export default function AiCheck() {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function check() {
    setBusy(true);
    setErr("");
    setAnswer("");
    try {
      const res = await fetch("/api/ai-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fel");
      setAnswer(data.answer);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 18px 80px" }}>
      <Link href="/" style={{ color: "#e7a23a" }}>← DeployDoctor</Link>
      <h1 style={{ fontSize: 40, margin: "16px 0 8px" }}>AI-check</h1>
      <p style={{ color: "#b7ab9a" }}>Klistra in en text. Får svar om den ser skriven av en modell ut.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Klistra in text här (minst 40 tecken)"
        style={{ width: "100%", height: 180, marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #3a3228", background: "#1e1a14", color: "#f4efe6", fontSize: 15 }}
      />
      <button
        onClick={check}
        disabled={busy || text.trim().length < 40}
        style={{ marginTop: 12, height: 48, padding: "0 24px", borderRadius: 12, border: 0, background: "#e7a23a", color: "#1a140c", fontWeight: 600, cursor: "pointer" }}
      >
        {busy ? "Kollar..." : "Kolla"}
      </button>
      {err && <p style={{ color: "#e74c3c", marginTop: 12 }}>{err}</p>}
      {answer && <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", color: "#f4efe6" }}>{answer}</pre>}
    </main>
  );
}
