import type { Lang } from "@/lib/i18n";
import { handoffMarkdown, type DeployHandoff } from "@/lib/deploy-handoff";
import { CopyTextButton } from "@/components/copy-text-button";
import styles from "./pr-impact.module.css";

export function DeployHandoffPanel({ handoff, repoUrl, reportUrl, lang }: { handoff: DeployHandoff; repoUrl: string; reportUrl: string; lang: Lang }) {
  const sv = lang === "sv";
  const evidence = (task: DeployHandoff["tasks"][number]) => `${repoUrl}/blob/${task.side === "base" ? handoff.baseCommitSha : handoff.headCommitSha}/${task.file.split("/").map(encodeURIComponent).join("/")}#L${task.line}`;
  return <section className={styles.panel} aria-labelledby="deploy-handoff-title">
    <p className="section-kicker">DEPLOY HANDOFF · {sv ? "MANUELL CHECKLISTA" : "MANUAL CHECKLIST"}</p>
    <h2 id="deploy-handoff-title">{sv ? "Koden är bara en del av din deploy." : "Your code change is only part of the deploy."}</h2>
    <p>{sv ? "Det här ändrades mellan PR-bas och head: granska vilka produktionsinställningar, databaser och flöden som behöver följa med." : "What changed between the PR base and head: review the production setup, database and flows that need to move with the code."}</p>
    <p className={styles.notice}>{sv ? "Varje steg måste verifieras manuellt. Inget är automatiskt avklarat eller ett besked om att det är säkert att släppa." : "Every step requires manual verification. Nothing is automatically complete or a clearance to release."}</p>
    {!handoff.complete && <p>{sv ? "Täckningen är begränsad. Omatchade poster är granskningsförslag, inte säkert nya eller borttagna." : "Coverage is limited. Unmatched items are review candidates, not proven additions or removals."}</p>}
    <CopyTextButton text={handoffMarkdown(handoff,reportUrl)} label={sv ? "Kopiera deploy-checklista" : "Copy deploy checklist"} copiedLabel={sv ? "Kopierad" : "Copied"} />
    {handoff.tasks.length ? <ol className={styles.findings}>{handoff.tasks.map(task=><li key={task.id}>
      <span className={styles.severity}>{task.change} · {task.confidence === "observed-change" ? "Observed source change" : "Needs review"}</span>
      <strong>{task.title}</strong><a className={styles.file} href={evidence(task)} target="_blank" rel="noopener noreferrer">{task.file}:{task.line} ↗</a>
      <p>{task.action}</p><p><strong>{sv ? "Verifiera" : "Verify"}:</strong> {task.verification}</p>
    </li>)}</ol> : <p>{sv ? "Inga matchningsbara ändringar i den begränsade deploy-inventeringen. Slutför ändå de manuella kontrollerna." : "No matching changes in the limited deployment inventory. Complete the manual checks below anyway."}</p>}
    <h3>{sv ? "Före och efter deploy" : "Before and after deploy"}</h3>
    <ul>{handoff.manualChecks.map(check=><li key={check}>{check}</li>)}</ul>
    <details><summary>{sv ? "Underlag och begränsningar" : "Evidence and limitations"}</summary><p>Base: <code>{handoff.baseCommitSha}</code><br />Head: <code>{handoff.headCommitSha}</code></p><ul>{handoff.limitations.map(note=><li key={note}>{note}</li>)}</ul></details>
  </section>;
}
