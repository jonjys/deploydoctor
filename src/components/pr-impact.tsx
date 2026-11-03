import type { ImpactFinding, PullRequestImpact } from "@/lib/pr-impact";
import type { Lang } from "@/lib/i18n";
import styles from "./pr-impact.module.css";

export function PrImpact({ impact, repoUrl, lang }: { impact: PullRequestImpact; repoUrl: string; lang: Lang }) {
  const sv = lang === "sv";
  const location = (f: ImpactFinding, sha: string) => `${repoUrl}/blob/${sha}/${f.file.split("/").map(encodeURIComponent).join("/")}#L${Math.max(1, f.line)}`;
  const findings = (items: ImpactFinding[], sha: string) => <ul className={styles.findings}>{items.map((f, i) => <li key={`${f.checkId}-${f.file}-${f.line}-${i}`}>
    <span className={styles.severity}>{f.status === "red" ? (sv ? "Kodfynd" : "Source finding") : (sv ? "Granska" : "Needs review")}</span>
    <strong>{f.problem}</strong>
    <a className={styles.file} href={location(f, sha)} target="_blank" rel="noopener noreferrer">{f.file}:{f.line} ↗</a>
    <p>{f.fix}</p><a href={`#check-${f.checkId}`}>{sv ? "Kontroll och tillgängliga fixar ↓" : "Check and available fixes ↓"}</a>
  </li>)}</ul>;
  return <section className={styles.panel} aria-labelledby="pr-impact-title">
    <p className="section-kicker">{sv ? "PR-JÄMFÖRELSE" : "PR CHANGE REVIEW"} · <a href={impact.url}>#{impact.number}</a></p>
    <h2 id="pr-impact-title">{sv ? "Vad ändrar den här PR:en?" : "What does this PR change?"}</h2>
    <p>{sv ? "Samma analys på två fasta commits. Gamla fynd hålls isär från nytillkomna." : "The same analysis at two pinned commits. Existing findings stay separate from newly detected ones."}</p>
    <div className={styles.commits}>
      <span>{sv ? "Gemensam bas" : "Merge base"}: <a href={`${repoUrl}/commit/${impact.baseCommitSha}`}>{impact.baseCommitSha.slice(0, 12)}</a></span>
      <span>PR head: <a href={`${repoUrl}/commit/${impact.headCommitSha}`}>{impact.headCommitSha.slice(0, 12)}</a></span>
    </div>
    <dl className={styles.counts}>
      <div><dt>{sv ? "Nytillkomna fynd" : "Newly detected"}</dt><dd>{impact.introduced.length}</dd></div>
      <div><dt>{sv ? "Fanns redan" : "Already present"}</dt><dd>{impact.persisting.length}</dd></div>
      <div><dt>{sv ? "Hittas inte längre" : "No longer detected"}</dt><dd>{impact.noLongerDetected.length}</dd></div>
    </dl>
    {(impact.partial || impact.notCompared.length > 0 || impact.uncertain.length > 0) && <p className={styles.notice} role="note">{sv ? "Jämförelsen har täckningsluckor. Omatchade fynd kan inte säkert kallas nya eller lösta. Se osäkra fynd och begränsningar nedan." : "This comparison has coverage gaps. Unmatched findings cannot be called new or resolved. Review uncertain findings and limitations below."}</p>}
    <h3>{sv ? "Börja med nytillkomna fynd" : "Start with newly detected findings"}</h3>
    {impact.introduced.length ? findings(impact.introduced.slice(0, 3), impact.headCommitSha) : <p>{sv ? "Inga nya matchningsbara fynd i jämförbara kontroller. Det bevisar inte att PR:en är säker att merga." : "No newly detected findings in comparable checks. This does not establish that the PR is safe to merge."}</p>}
    {impact.introduced.length > 3 && <details><summary>{sv ? "Fler nytillkomna fynd" : "More newly detected findings"} ({impact.introduced.length - 3})</summary>{findings(impact.introduced.slice(3), impact.headCommitSha)}</details>}
    {!!impact.persisting.length && <details><summary>{sv ? "Fanns redan i basen" : "Already present at the base"} ({impact.persisting.length})</summary>{findings(impact.persisting, impact.headCommitSha)}</details>}
    {!!impact.noLongerDetected.length && <details><summary>{sv ? "Hittas inte längre i PR head" : "No longer detected at the PR head"} ({impact.noLongerDetected.length})</summary><p>{sv ? "Frånvaro i statisk analys är inte ett verifierat fixresultat." : "Absence in static analysis is not a verified fix result."}</p>{findings(impact.noLongerDetected, impact.baseCommitSha)}</details>}
    {!!impact.uncertain.length && <details><summary>{sv ? "Osäker jämförelse" : "Uncertain comparison"} ({impact.uncertain.length})</summary>{impact.uncertain.map((f, i) => <div key={i}><p>{f.side === "base" ? "Merge base" : "PR head"}</p>{findings([f], f.side === "base" ? impact.baseCommitSha : impact.headCommitSha)}</div>)}</details>}
    <details><summary>{sv ? "Vad jämförelsen inte bevisar" : "What this comparison does not prove"}</summary>
      <ul>{impact.limitations.map(note => <li key={note}>{note}</li>)}</ul>
      {!!impact.notCompared.length && <p>{sv ? "Inte fullt jämförbara kontroller" : "Checks without a full comparison"}: {impact.notCompared.join(", ")}</p>}
      <p>{sv ? "Ett PR-snapshot, inte en prognos för resultatet efter merge. Granska hela rapporten och kör ditt produktionsbygge." : "A PR snapshot, not a prediction of the merged result. Review the full report and run your production build."}</p>
    </details>
  </section>;
}
