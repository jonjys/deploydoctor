import Link from "next/link";
import { dateLocale, t, type Lang, type MessageKey } from "@/lib/i18n";
import { hasChanges, improved, type ChangedFinding, type ReportDiff } from "@/lib/report-insights";
import type { CheckStatus } from "@/types/report";

const statusLabelKeys: Record<CheckStatus, MessageKey> = { red: "report.fail", yellow: "report.review", green: "report.pass" };
const SHOWN = 5;

/** `base` is the report the findings are in: fixed ones only exist on the previous report. */
function ChangedList({ items, base, lang }: { items: ChangedFinding[]; base: string; lang: Lang }) {
  return (
    <ul className="since-last-items">
      {items.slice(0, SHOWN).map((item, index) => (
        <li key={`${item.checkId}-${index}`}>
          <a href={`${base}#check-${item.checkId}`}><code>{item.file}:{item.line}</code></a> {item.problem}
        </li>
      ))}
      {items.length > SHOWN && <li className="since-last-more">{t(lang, "report.sinceMore", { n: items.length - SHOWN })}</li>}
    </ul>
  );
}

/** What was fixed and what is new since the previous public scan of the same repository. */
export function SinceLastScan({ diff, previous, lang }: { diff: ReportDiff; previous: { id: string; created_at: string }; lang: Lang }) {
  const date = new Date(previous.created_at).toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const changed = hasChanges(diff);
  return (
    <section className="since-last" aria-labelledby="since-heading">
      <div className="since-last-head">
        <h2 id="since-heading">{t(lang, "report.sinceTitle")}</h2>
        <Link href={`/r/${previous.id}`}>{t(lang, "report.sinceLink", { date: `${date} UTC` })}</Link>
      </div>
      {!changed && <p className="since-last-same">{t(lang, "report.sinceSame")}</p>}
      {diff.statusChanges.length > 0 && (
        <ul className="since-last-status" aria-label={t(lang, "report.sinceStatusAria")}>
          {diff.statusChanges.map((change) => (
            <li key={change.checkId} className={improved(change) ? "is-better" : "is-worse"}>
              {change.title}: {t(lang, statusLabelKeys[change.from])} → {t(lang, statusLabelKeys[change.to])}
            </li>
          ))}
        </ul>
      )}
      {(diff.fixed.length > 0 || diff.added.length > 0) && (
        <div className="since-last-lists">
          {diff.fixed.length > 0 && (
            <div className="is-fixed">
              <h3>{t(lang, "report.sinceFixed", { n: diff.fixed.length })}</h3>
              <ChangedList items={diff.fixed} base={`/r/${previous.id}`} lang={lang} />
            </div>
          )}
          {diff.added.length > 0 && (
            <div className="is-new">
              <h3>{t(lang, "report.sinceNew", { n: diff.added.length })}</h3>
              <ChangedList items={diff.added} base="" lang={lang} />
            </div>
          )}
        </div>
      )}
      {diff.partial && changed && <p className="since-last-note">{t(lang, "report.sincePartial")}</p>}
      {diff.statusOnly.length > 0 && <p className="since-last-note">{t(lang, "report.sinceStatusOnly")}</p>}
    </section>
  );
}
