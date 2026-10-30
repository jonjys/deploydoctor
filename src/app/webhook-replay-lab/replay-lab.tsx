"use client";

import { useState } from "react";
import { deliverSample, freshLab, restartWorker } from "@/lib/replay-lab";
import styles from "./replay-lab.module.css";

export function ReplayLab() {
  const [state, setState] = useState(freshLab);
  const [failNext, setFailNext] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  function deliver(count = 1, differentEvent = false) {
    setState(previous => {
      let next = previous;
      for (let i = 0; i < count; i++) next = deliverSample(next, differentEvent ? `evt_demo_other_${previous.deliveries + i}` : "evt_demo_1", "cs_demo_1", failNext && i === 0);
      return next;
    });
    setFailNext(false);
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/webhook-replay-lab`); setCopied(true); setCopyFailed(false); }
    catch { setCopied(false); setCopyFailed(true); }
  }
  const cases = [
    { label: "No duplicate guard", count: state.naive, tone: styles.naive, note: "Every successful delivery grants access again." },
    { label: "Event ID in memory", count: state.memory, tone: styles.memory, note: "Forgets after restart. A claim before a crash can lose work." },
    { label: "Unique purchase + transaction", count: state.transaction, tone: styles.durable, note: "Models one DB commit: purchase key and access grant together." },
  ];
  return <section className={styles.lab} aria-labelledby="lab-heading">
    <div className={styles.labTop}><div><p className="section-kicker">SAMPLE PURCHASE · cs_demo_1</p><h2 id="lab-heading">Try to grant access twice.</h2></div><span className={styles.counter}>{state.deliveries} deliveries</span></div>
    <div className={styles.controls}>
      <button className="cta-button" onClick={() => deliver()}>Deliver event →</button>
      <button onClick={() => deliver(4)}>Replay 4 more times</button>
      <button onClick={() => deliver(1, true)}>New event ID, same purchase</button>
    </div>
    <div className={styles.faults}><label><input type="checkbox" checked={failNext} onChange={event => setFailNext(event.target.checked)} /> Crash next delivery before access is granted</label><button onClick={() => setState(restartWorker)}>Restart worker</button><button onClick={() => { setState(freshLab()); setFailNext(false); }}>Reset lab</button></div>
    <div className={styles.results} aria-live="polite" aria-atomic="true">
      {cases.map(item => <article key={item.label} className={`${styles.result} ${item.tone}`}><h3>{item.label}</h3><strong>{item.count}</strong><span>simulated access {item.count === 1 ? "grant" : "grants"}</span><p>{item.note}</p></article>)}
    </div>
    <p className={styles.hint}>Try this: reset → enable crash → deliver → deliver again. The memory guard skips unfinished work; the simulated transaction rolls back and can retry.</p>
    <details className={styles.trace}><summary>Delivery trace · last 6 actions</summary><ol>{state.log.length ? state.log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>) : <li>No sample event delivered yet.</li>}</ol></details>
    <div className={styles.share}><span>Send this to the person who wrote your webhook.</span><button onClick={() => void copyLink()}>{copied ? "Link copied ✓" : "Copy lab link"}</button><a href="https://twitter.com/intent/tweet?text=One%20payment.%20Five%20webhook%20deliveries.%20How%20many%20access%20grants%3F%20Try%20this%20free%20browser%20simulation%3A&url=https%3A%2F%2Fdeploydoctor.nyttolabs.com%2Fwebhook-replay-lab" target="_blank" rel="noopener noreferrer">Share on X ↗</a></div>
    {copied && <p role="status">Lab link copied. The recipient gets a fresh simulation.</p>}
    {copyFailed && <p role="status">Could not copy automatically. Copy this link: <a href="https://deploydoctor.nyttolabs.com/webhook-replay-lab">https://deploydoctor.nyttolabs.com/webhook-replay-lab</a></p>}
  </section>;
}
