import type { ContextualFinding, FindingOrigin } from "@/lib/pr-impact";
import type { Lang } from "@/lib/i18n";
import styles from "./pr-finding-list.module.css";

const labels: Record<"en" | "sv", Record<FindingOrigin, string>> = {
  en: { introduced: "Newly detected in this PR", existing: "Already present at the base", uncertain: "Origin needs review" },
  sv: { introduced: "Nytillkommet fynd i PR:en", existing: "Fanns redan i basen", uncertain: "Ursprung behöver granskas" },
};

function FindingItem({ finding, lang }: { finding: ContextualFinding; lang: Lang }) {
  return <li className={styles.finding}>
    <span className={`${styles.origin} ${styles[finding.prOrigin]}`}>{labels[lang][finding.prOrigin]}</span>
    <span className={styles.severity}>{finding.status === "red" ? (lang === "sv" ? "Kodfynd" : "Source finding") : (lang === "sv" ? "Behöver granskas" : "Needs review")}</span>
    <strong>{finding.problem}</strong>
    <code>{finding.file}:{finding.line}</code>
    <p>{finding.fix}</p>
  </li>;
}

/** Native disclosure keeps inherited problems available without adding browser state or hiding uncertainty. */
export function PrFindingList({ findings, lang }: { findings: ContextualFinding[]; lang: Lang }) {
  if (!findings.length) return null;
  const current = findings.filter(f => f.prOrigin !== "existing"), existing = findings.filter(f => f.prOrigin === "existing");
  const sv = lang === "sv";
  return <section className={styles.context} aria-label={sv ? "Fynd med PR-kontext" : "Findings with PR context"}>
    <p className={styles.note}>{sv ? "Nytillkomna och osäkra fynd först. Hela kontrollens status omfattar även tidigare problem." : "New and uncertain findings first. The full check status still includes existing problems."}</p>
    {current.length > 0 && <ul className={styles.list}>{current.map((finding, i) => <FindingItem key={i} finding={finding} lang={lang} />)}</ul>}
    {current.length === 0 && <p>{sv ? "Alla matchade fynd i denna kontroll fanns redan i basen." : "All matched findings in this check were already present at the base."}</p>}
    {existing.length > 0 && <details className={styles.existingGroup}>
      <summary>{sv ? "Visa fynd som fanns sedan tidigare" : "Show already-present findings"} ({existing.length})</summary>
      <ul className={styles.list}>{existing.map((finding, i) => <FindingItem key={i} finding={finding} lang={lang} />)}</ul>
    </details>}
  </section>;
}
