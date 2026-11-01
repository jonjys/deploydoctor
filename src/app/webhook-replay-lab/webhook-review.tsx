"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { scanCheckoutHref } from "@/lib/scan-checkout";
import { findSecrets } from "@/lib/secrets";
import { WEBHOOK_EXAMPLE } from "@/lib/webhook-example";
import { webhookContract, webhookContractInstructions } from "@/lib/webhook-contract";
import type { WebhookReview } from "@/lib/webhook-review";
import styles from "./webhook-review.module.css";

function download(name: string, content: string) {
  const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),10_000);
}
export function WebhookReviewForm() {
  const [source,setSource]=useState(""),[schema,setSchema]=useState("");
  const [framework,setFramework]=useState<"next-app"|"next-pages"|"express">("next-app");
  const [schemaType,setSchemaType]=useState<"sql"|"prisma">("sql");
  const [result,setResult]=useState<WebhookReview|null>(null),[error,setError]=useState(""),[paywall,setPaywall]=useState(false),[busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  function invalidate() { setResult(null);setError("");setPaywall(false); }
  async function review() {
    invalidate();
    if(findSecrets(source+"\n"+schema).length){setError("Remove keys and credentials before submitting. Code was not sent.");return;}
    setBusy(true);const current=new AbortController();controller.current=current;
    try {
      const response=await fetch("/api/webhook-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source,schema,framework,schemaType}),signal:current.signal});
      const data=await response.json();
      if(!response.ok){setPaywall(data.paywall===true);throw new Error(data.error??"Review could not finish.");}
      setResult(data);
    } catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:"Review could not finish.");}
    finally{setBusy(false);}
  }
  return <section id="review-your-webhook" className={styles.review} aria-labelledby="review-title">
    <div className={styles.heading}><div><p className="section-kicker">YOUR CODE. NO GITHUB CONNECTION.</p><h2 id="review-title">Where could your webhook repeat the work?</h2></div><span className={styles.tag}>Static review + test scaffold</span></div>
    <p className={styles.intro}>Paste one JavaScript or TypeScript handler. Get line evidence, then download five regression tests to connect to your own app.</p>
    <form onSubmit={event=>{event.preventDefault();void review();}}>
      <label htmlFor="webhook-framework">Handler type</label><select id="webhook-framework" value={framework} disabled={busy} onChange={e=>{setFramework(e.target.value as typeof framework);invalidate();}}><option value="next-app">Next.js App Router</option><option value="next-pages">Next.js Pages API</option><option value="express">Express</option></select>
      <div className={styles.labelRow}><label htmlFor="webhook-source">Webhook handler</label><button type="button" disabled={busy} onClick={()=>{setSource(WEBHOOK_EXAMPLE);setFramework("next-app");setSchema("");invalidate();}}>Load an example</button></div>
      <textarea id="webhook-source" value={source} disabled={busy} onChange={e=>{setSource(e.target.value);invalidate();}} rows={9} minLength={20} maxLength={40_000} spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="Paste your handler source here. Remove secrets and customer data first." required aria-describedby="code-privacy" />
      <details className={styles.schema}><summary>Optional: SQL or Prisma schema for stronger constraint evidence</summary><label htmlFor="webhook-schema-type">Schema type</label><select id="webhook-schema-type" disabled={busy} value={schemaType} onChange={e=>{setSchemaType(e.target.value as typeof schemaType);invalidate();}}><option value="sql">SQL migration</option><option value="prisma">Prisma schema</option></select><label htmlFor="webhook-schema">Relevant table definitions</label><textarea id="webhook-schema" value={schema} disabled={busy} rows={5} maxLength={30_000} onChange={e=>{setSchema(e.target.value);invalidate();}} spellCheck={false} placeholder="Only schema definitions. No production rows or credentials." /></details>
      <p id="code-privacy" className={styles.privacy}>Code is sent to DeployDoctor for deterministic analysis, not AI. We do not save your pasted source or include it in downloads. Remove secrets and personal data. One free review or repo scan per day shares the same allowance; existing passes apply.</p>
      <button className={styles.primary} type="submit" disabled={busy} aria-busy={busy}>{busy?"Inspecting source patterns…":"Review my webhook →"}</button>
    </form>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {paywall&&<div className={styles.paywall}><a className="cta-button" href={scanCheckoutHref("day")} target="_blank" rel="noopener noreferrer">Continue for 24 hours · $2 ↗</a><p>One-time payment. No subscription. Your pasted source is not sent to checkout or saved for restoration. Checkout opens in a new tab. Return here and review again after paying.</p></div>}
    {result&&<div className={styles.result} aria-live="polite">
      <p className="section-kicker">{result.findings.length?"REVIEW THESE PATTERNS":"LIMITED REVIEW"}</p><h3>{result.summary}</h3>
      <ul className={styles.findings}>{result.findings.map((finding,index)=><li key={`${finding.file}-${finding.line}-${finding.ruleId}-${index}`}><div className={styles.findingTop}><strong>{finding.status==="red"?"Source finding":"Needs review"}</strong><span>{finding.file}:{finding.line}</span></div><p>{finding.problem}</p>{finding.excerpt&&<pre><code>{finding.excerpt}</code></pre>}<p><b>Next step:</b> {finding.fix}</p></li>)}</ul>
      <details><summary>What was checked and what remains unknown</summary><p>{result.evaluatedRules.length?result.evaluatedRules.join(", "):"No supported local payment pattern could be established."}</p><ul>{result.limitations.map(item=><li key={item}>{item}</li>)}</ul></details>
      <div className={styles.pack}><h3>Turn this review into regression tests.</h3><p>Five scenarios: retries, concurrent duplicates, worker restart, two event IDs for one purchase, and a crash before fulfillment. Connect the scaffold to your real test code. It fails until configured; no application has been tested yet.</p><div className={styles.downloads}><button type="button" onClick={()=>download("deploydoctor-webhook.contract.test.mjs",webhookContract())}>Download test scaffold</button><button type="button" onClick={()=>download("deploydoctor-webhook-setup.txt",webhookContractInstructions())}>Download setup instructions</button></div></div>
      <p><Link href="/?utm_source=webhook-review&utm_medium=tool#scan-repository">Need imported helpers and repository context? Scan your repo →</Link></p>
    </div>}
    {!result&&<details className={styles.packPreview}><summary>Just need the regression-test scaffold?</summary><p>Download it without submitting code. You must implement a local adapter against an isolated test database.</p><div className={styles.downloads}><button type="button" onClick={()=>download("deploydoctor-webhook.contract.test.mjs",webhookContract())}>Download five tests</button><button type="button" onClick={()=>download("deploydoctor-webhook-setup.txt",webhookContractInstructions())}>Setup instructions</button></div></details>}
  </section>;
}
