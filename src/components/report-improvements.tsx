import { improvementCopy, shareText, type Improvement } from "@/lib/improvements";
import type { Lang } from "@/lib/i18n";

/** The pre-filled X post for a public report. Private reports are never shared. */
export function ShareOnX({ repo, url, summary, improvements, lang, className = "share-x" }: { repo: string; url: string; summary: { red: number; yellow: number }; improvements: number; lang: Lang; className?: string }) {
  const href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(repo, summary, improvements, lang))}&url=${encodeURIComponent(url)}`;
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{lang === "sv" ? "Dela på X" : "Share on X"} ↗</a>;
}

const FIRST = 4;

/** Not errors: what the scan can see is missing that would make this app better on Vercel. */
export function ReportImprovements({ items, lang, isPrivate, share }: { items: Improvement[]; lang: Lang; isPrivate: boolean; share?: React.ReactNode }) {
  const visible = items.filter(item => !(isPrivate && item.id === "readme-badge"));
  if (!visible.length) return null;
  const sv = lang === "sv";
  const card = (item: Improvement) => {
    const copy = improvementCopy(item, lang);
    const external = copy.docs && /^https?:/.test(copy.docs);
    return (
      <li key={item.id} id={`improvement-${item.id}`}>
        <strong>{copy.title}</strong>
        <p>{copy.why}</p>
        <p className="improvement-how">{copy.how}</p>
        {copy.docs && <a href={copy.docs} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{external ? (sv ? "Dokumentation" : "Documentation") : item.id === "ci-check" ? (sv ? "Lägg till Actionen" : "Add the Action") : (sv ? "Kopiera badgen" : "Copy the badge")} {external ? "↗" : "→"}</a>}
      </li>
    );
  };
  return (
    <section className="improvements" id="improvements" aria-labelledby="improvements-heading">
      <div className="improvements-head">
        <div>
          <p className="section-kicker">{sv ? "UTÖVER FELEN" : "BEYOND THE ERRORS"}</p>
          <h2 id="improvements-heading">{sv ? `${visible.length} förbättring${visible.length === 1 ? "" : "ar"} för det här repot` : `${visible.length} improvement${visible.length === 1 ? "" : "s"} for this repo`}</h2>
          <p>{sv ? "Inga fel, utan saker skanningen ser saknas och som gör appen bättre på Vercel. Gratis i varje rapport." : "Not errors: things the scan can see are missing that make this app better on Vercel. Free in every report."}</p>
        </div>
        {share}
      </div>
      <ol className="improvement-list">{visible.slice(0, FIRST).map(card)}</ol>
      {visible.length > FIRST && <details className="improvement-more">
        <summary>{sv ? `Visa ${visible.length - FIRST} till` : `Show ${visible.length - FIRST} more`}</summary>
        <ol className="improvement-list">{visible.slice(FIRST).map(card)}</ol>
      </details>}
    </section>
  );
}
