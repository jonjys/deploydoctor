"use client";

import Link from "next/link";
import { CopyTextButton } from "@/components/copy-text-button";
import { Breakable } from "@/components/breakable-path";
import { useLang } from "@/components/lang";
import { useIgnoredCheckIds } from "@/components/report-ignore";
import type { FixFirstItem } from "@/lib/report-insights";
import nextStyles from "./next-move.module.css";

/**
 * The first useful decision in a report, not another dashboard.
 * Reuses the audited fix ordering and respects local ignore preferences.
 * Neither a "pass" nor a suggested fix is proof of a successful deployment.
 */
export function NextMove({ items, partial, rescanHref }: { items: FixFirstItem[]; partial: boolean; rescanHref: string }) {
  const ignored = useIgnoredCheckIds();
  const lang = useLang();
  const sv = lang === "sv";
  const available = items.filter(item => !ignored.has(item.checkId));
  const first = available[0];

  if (!first) return <section className={nextStyles.panel} aria-labelledby="next-move-title">
    <span className={nextStyles.kicker}>{sv ? "DITT NÄSTA STEG" : "YOUR NEXT MOVE"}</span>
    <h2 id="next-move-title">{partial ? (sv ? "Slutför skanningen först" : "Complete the scan first") : (sv ? "Inga öppna fynd i genomförda kontroller" : "No open findings in the completed checks")}</h2>
    <p>{partial ? (sv ? "Delar av repot kunde inte läsas. Kör om skanningen innan du drar slutsatser." : "Some source files could not be read. Retry the scan before drawing conclusions.") : (sv ? "Det här är inte ett godkännande av produktionen. Testa din riktiga app och betalflöden separat." : "This is not a production approval. Test the live app and payment flows separately.")}</p>
    <div className={nextStyles.actions}><Link href={rescanHref} className={nextStyles.primary}>{sv ? "Skanna igen" : "Rescan repo"} <span aria-hidden="true">↗</span></Link><Link href="/safe" className={nextStyles.secondary}>{sv ? "Kontrollera liveappen" : "Check the live app"}</Link></div>
  </section>;

  return <section className={`${nextStyles.panel} ${first.status === "red" ? nextStyles.urgent : nextStyles.review}`} aria-labelledby="next-move-title">
    <div className={nextStyles.top}><span className={nextStyles.kicker}>{sv ? "DITT NÄSTA STEG" : "YOUR NEXT MOVE"} · {first.status === "red" ? (sv ? "FEL FUNNET" : "CONFIRMED FINDING") : (sv ? "BÖR GRANSKAS" : "NEEDS REVIEW")}</span><span className={nextStyles.counter}>1 / {available.length}</span></div>
    <h2 id="next-move-title">{first.title}</h2>
    {first.file && <p className={nextStyles.file}><Breakable text={first.line ? `${first.file}:${first.line}` : first.file} /></p>}
    {first.completeFile ? <p>{sv ? "En hel fil föreslås. Öppna fyndet och granska innan du ändrar något." : "A complete file is suggested. Review the finding before changing anything."}</p> :
      first.fix ? <p className={nextStyles.fix}>{first.fix}</p> : <p>{sv ? "Öppna fyndet för underlag och möjliga åtgärder." : "Open the finding for evidence and possible next steps."}</p>}
    <div className={nextStyles.actions}>
      <a href={`#check-${first.checkId}`} className={nextStyles.primary}>{sv ? "Visa underlag och fix" : "See evidence and fix"} <span aria-hidden="true">↓</span></a>
      {first.command && !first.completeFile ? <CopyTextButton text={first.command} label={sv ? "Kopiera kommando" : "Copy command"} copiedLabel={sv ? "Kopierat" : "Copied"} /> : null}
      {available.length > 1 && <a href="#checks" className={nextStyles.secondary}>{sv ? `Visa övriga ${available.length - 1} steg` : `See ${available.length - 1} more steps`}</a>}
    </div>
    <details className={nextStyles.why}><summary>{sv ? "Varför just detta?" : "Why this first?"}</summary><p>{sv ? "Verifierade fel visas före granskningar, baserat på fynd i den här skanningen. Ingen kod ändras automatiskt. Kör en ny skanning efter ändringar." : "Confirmed source findings come before review items, using this scan only. No code is changed automatically. Rescan after making changes."}</p></details>
  </section>;
}
