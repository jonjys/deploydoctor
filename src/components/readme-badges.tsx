import { CopyTextButton } from "@/components/copy-text-button";
import { t, type Lang } from "@/lib/i18n";
import { repoFromPath } from "@/lib/repo-link";
import { liveBadgeMarkdown } from "@/lib/repo-status";
import { SITE_URL } from "@/lib/site";

/** The status badge of a saved public report, linking to the report. */
export function reportBadgeMarkdown(id: string): string {
  return `[![DeployDoctor](${SITE_URL}/r/${id}/badge)](${SITE_URL}/r/${id})`;
}

/**
 * The Scan with DeployDoctor button: the repository's instant scan link, which starts a scan of whatever the
 * repository holds when it is clicked. Meant for templates and starters, whose forks keep the README.
 * An owner the instant link reserves (GitHub allows logins such as r, ci or stats) gets the home page link
 * instead, the one the rescan link uses, which starts the same scan on arrival.
 */
export function scanButtonMarkdown(owner: string, name: string): string {
  const target = repoFromPath([owner, name]) ? `${SITE_URL}/${owner}/${name}` : `${SITE_URL}/?repo=${owner}/${name}`;
  return `[![Scan with DeployDoctor](${SITE_URL}/badge.svg)](${target})`;
}

/** The README snippets a public report offers: its own status badge, and below it the scan button of its repository. */
export function ReadmeBadges({ id, owner, name, overall, lang }: { id: string; owner: string; name: string; overall: string; lang: Lang }) {
  const badge = reportBadgeMarkdown(id);
  const button = scanButtonMarkdown(owner, name);
  return (
    <details className="report-secondary report-sharing"><summary>{t(lang, "report.shareDetails")}</summary>
      <section className="badge-section" aria-labelledby="badge-heading">
        <div>
          <h2 id="badge-heading">{t(lang, "report.badgeTitle")}</h2>
          <p>{t(lang, "report.badgeBody")}</p>
        </div>
        <div className="badge-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/r/${id}/badge`} alt={`DeployDoctor: ${overall}`} height={20} />
          <code>{badge}</code>
          <CopyTextButton text={badge} label={t(lang, "report.badgeCopy")} copiedLabel={t(lang, "report.badgeCopied")} />
        </div>
      </section>
      <section className="badge-section" aria-labelledby="live-badge-heading">
        <div><h2 id="live-badge-heading">{lang === "sv" ? "Senaste repo-status i din README" : "Latest repo status in your README"}</h2><p>{lang === "sv" ? "Samma länk visar senaste publika skanningen av standardgrenen, med datum och commit. Visningar startar inga skanningar." : "One link follows the latest public scan of the default branch, with its date and commit. Views never start scans."}</p></div>
        <p><LinkStatus owner={owner} name={name} lang={lang} /></p>
      </section>
      <section className="badge-section" aria-labelledby="scan-button-heading">
        <div>
          <h2 id="scan-button-heading">{t(lang, "report.scanButtonTitle")}</h2>
          <p>{t(lang, "report.scanButtonBody")}</p>
        </div>
        <div className="badge-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/badge.svg" alt="Scan with DeployDoctor" height={20} />
          <code>{button}</code>
          <CopyTextButton text={button} label={t(lang, "report.badgeCopy")} copiedLabel={t(lang, "report.badgeCopied")} />
        </div>
      </section>
    </details>
  );
}

function LinkStatus({ owner, name, lang }: { owner: string; name: string; lang: Lang }) {
  const markdown = liveBadgeMarkdown(owner, name, SITE_URL);
  return <><a href={`/score/${owner}/${name}`}>{lang === "sv" ? "Öppna repo-status" : "Open repo status"} →</a><code className="live-badge-code">{markdown}</code><CopyTextButton text={markdown} label={lang === "sv" ? "Kopiera statusbadge" : "Copy status badge"} copiedLabel={lang === "sv" ? "Kopierat" : "Copied"} /></>;
}
