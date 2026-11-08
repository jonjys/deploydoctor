import { Suspense } from "react";
import { ScanActivitySection } from "@/components/scan-activity-section";
import { CommunityReviews } from "@/components/community-reviews";
import Link from "next/link";
import { RepoForm } from "@/components/repo-form";
import { EXAMPLE_REPORTS, SITE_URL } from "@/lib/site";
import { allowsPrivate } from "@/lib/plans";
import { activePlan, customerSession } from "@/lib/access";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { analysisText } from "@/lib/analysis-text";
import { getT } from "@/lib/lang";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { fixesConfirmed, reposScanned } from "@/lib/stats";
import { formatCount } from "@/lib/format-count";
import { RecentScans } from "@/components/solved-prompt";
import { fixPullRequestsEnabled } from "@/lib/fix-pr/github-app";

/** Who runs DeployDoctor and what it is, for Google and AI assistants. No prices, so it cannot go stale. */
const SCHEMA = { "@context": "https://schema.org", "@graph": [
  { "@type": "Organization", "@id": "https://nyttolabs.com/#org", name: "Nytto Labs", url: "https://nyttolabs.com", email: "support@nyttolabs.com",
    address: { "@type": "PostalAddress", addressCountry: "SE" } },
  { "@type": "SoftwareApplication", name: "DeployDoctor", url: SITE_URL, applicationCategory: "DeveloperApplication", operatingSystem: "Web",
    description: "Finds what will break a deploy before the host builds it, and checks a live site for leaked keys, EU rules, VAT number and AI search.",
    publisher: { "@id": "https://nyttolabs.com/#org" }, offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free daily scan and free live site check." } },
] };

export default async function Home() {
  const [plan, scanned, fixed] = await Promise.all([customerSession().then(activePlan), reposScanned(), fixesConfirmed()]);
  const { lang, t } = await getT();
  const fixOn = fixPullRequestsEnabled();
  const { titles } = analysisText(lang);
  // The same titles the analyzer prints, in report order. Supabase and Prisma only run when the stack uses them.
  const checks: Array<{ title: string; whenUsed?: boolean; note?: string }> = [
    { title: titles.nextEntry }, { title: titles.imports }, { title: lang === "sv" ? "Server- och runtime-risker" : "Server and runtime risks" }, { title: titles.buildConfig, note: t("home.checkStacks") },
    { title: titles.dependencies }, { title: lang === "sv" ? "Betalning och produktionsrisker" : "Payment and production safety" }, { title: titles.env }, { title: titles.secrets },
    { title: titles.supabase, whenUsed: true }, { title: titles.prisma, whenUsed: true },
  ];
  return (
    <main className="site-shell home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA).replace(/</g, "\\u003c") }} />
      <SiteNav current="scan" />

      <RecentScans />

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-icon">✦</span>
          {t("home.eyebrow")}
        </div>
        {/* The fix promise only once Fix pull requests can actually be bought. */}
        <h1>{t(fixOn ? "home.h1.fix" : "home.h1")}</h1>
        <p className="hero-copy">{t(fixOn ? "home.copy.fix" : "home.copy")}</p>

        <div id="scan-repository" className="scan-entry">
        <Suspense fallback={null}>
          <RepoForm privateAccess={allowsPrivate(plan?.plan)} />
        </Suspense>
        </div>
        <div className="entry-paths" aria-label={lang === "sv" ? "Välj vad du behöver hjälp med" : "Choose what you need help with"}>
          <a className="entry-path" href="#scan-repository"><span className="section-kicker">{lang === "sv" ? "INNAN DU PUSHAR" : "BEFORE YOU PUSH"}</span><h2>{lang === "sv" ? "Skanna ett repo" : "Scan repository"} <span aria-hidden="true">↘</span></h2><p>{lang === "sv" ? "Hitta risker i koden. Se fil, rad och nästa steg." : "Find risks in your code. See the file, line and next step."}</p></a>
          <Link className="entry-path entry-path-log" href="/fix"><span className="section-kicker">{lang === "sv" ? "BYGGET HAR REDAN MISSLYCKATS" : "BUILD ALREADY FAILED"}</span><h2>{lang === "sv" ? "Fixa en misslyckad build" : "Fix a failed build"} <span aria-hidden="true">→</span></h2><p>{fixOn ? (lang === "sv" ? "Klistra in repot. Diagnosen är gratis. Pull requesten kostar $5 (ca 49 kr)." : "Paste the repo. Diagnosis is free. The pull request is $5.") : (lang === "sv" ? "Klistra in repot. Diagnosen är gratis. Pull requesten kommer snart." : "Paste the repo. Diagnosis is free. The pull request is coming soon.")}</p><span className="entry-allowance">{lang === "sv" ? "3 gratis diagnoser per dag" : "3 free diagnoses a day"}</span></Link>
        </div>
        <p className="plugin-line"><Link href="/leak-check">{lang === "sv" ? "Nytt: ligger din API-nyckel i din live-JavaScript? Gratis läckkoll →" : "New: is your API key in your live JavaScript? Free leak check →"}</Link></p>
        <p className="plugin-line"><Link href="/launch-manual">{lang === "sv" ? "Nytt: lanseringsplanen, från ditt repo till din första betalande kund →" : "New: your launch plan, from this repo to your first paying customer →"}</Link></p>
        <p className="plugin-line"><Link href="/deploy-handoff">{lang === "sv" ? "Nytt: se vad som måste följa med koden till produktion — Deploy Handoff →" : "New: see what must ship with your code — Deploy Handoff →"}</Link></p>
        <p className="plugin-line"><Link href="/platforms">{lang === "sv" ? "Se plattformar, språk och exakt vad som kontrolleras →" : "See supported platforms, languages and exactly what is checked →"}</Link></p>
        <div className="example-chips" aria-label={t("home.examples")}>
          <span>{t("home.examples")}</span>
          {EXAMPLE_REPORTS.map((example) => (
            <Link key={example.id} className={`example-chip is-${example.tone}`} href={`/r/${example.id}`}>
              <span className="chip-dot" aria-hidden="true" />{t(example.key)}
            </Link>
          ))}
        </div>

        <div className="trust-row" aria-label={t("home.trust.aria")}>
          {scanned !== null && (
            <span className="scan-count">
              <strong>{formatCount(lang, scanned)}</strong> {t("home.trust.scanned")}
            </span>
          )}
          {fixed !== null && (
            <span className="scan-count">
              <strong>{formatCount(lang, fixed)}</strong> {t("home.trust.fixed")}
            </span>
          )}
          <span>
            <span className="mini-check">✓</span> {plan ? t("home.trust.unlimited") : t("home.trust.free")}
          </span>
          <span>
            <span className="mini-check">✓</span> {t("home.trust.noexec")}
          </span>
          <span>
            <span className="mini-check">✓</span> {t("home.trust.share")}
          </span>
        </div>
        <p className="plugin-line"><Link href="/diagnose">{t("home.diagLine")}</Link>{" · "}<a href="#reviews">{lang === "sv" ? "Betyg & feedback" : "Ratings & feedback"}</a></p>
      </section>


      <p className="plugin-line"><Link href="/launch-readiness">{lang === "sv" ? "Ska du lansera? Se din tekniska checklista inför trafiken →" : "Launching a campaign? Check your deployment before the traffic arrives →"}</Link></p>
      <p className="plugin-line"><Link href="/webhook-replay-lab">{lang === "sv" ? "Nytt: klistra in din webhookkod och ladda ner regressionstester →" : "New: paste your webhook code and get a regression-test scaffold →"}</Link></p>
      <section className="checks-panel" aria-labelledby="checks-heading">
        <div>
          <p className="section-kicker">{t("home.preflight")}</p>
          <h2 id="checks-heading">{t("home.checksHeading")}</h2>
        </div>
        <ol className="check-list">
          {checks.map((check, index) => (
            <li key={check.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                {check.title}
                {check.whenUsed && <small className="check-when-used">{t("home.checkWhenUsed")}</small>}
                {check.note && <small className="check-when-used">{check.note}</small>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {!plan && (
        <section className="pass-strip" aria-labelledby="pass-heading">
          <div>
            <p className="section-kicker">{t("home.pass.kicker")}</p>
            <h2 id="pass-heading">{t("home.pass.h2")}</h2>
            <p>{t("home.pass.copy")}</p>
          </div>
          <div className="pass-actions">
            <ScanCheckoutButton plan="day">{t("home.pass.cta")}</ScanCheckoutButton>
            <Link href="/pricing">{t("home.pass.more")}</Link>
          </div>
        </section>
      )}

      <section className="checks-panel" aria-label="Developer tools">
        <div><h2>{lang === "sv" ? "Använd där du bygger" : "Use it where you build"}</h2></div>
        <div>
          <p><Link href="/ci">GitHub Action →</Link></p>
          <p><Link href="/ai-plugin">Claude / Cursor MCP →</Link></p>
          <p>{t("home.urlTrick")}</p>
          <p><a href="https://fieldworkstudio.gumroad.com/l/vercel-deployment-rescue-kit">{lang === "sv" ? "Föredrar du en nedladdningsbar guide? Rescue Kit · $19 →" : "Prefer a downloadable guide? Rescue Kit · $19 →"}</a></p>
        </div>
      </section>

      <Suspense fallback={null}><ScanActivitySection /></Suspense>
      <Suspense fallback={null}><CommunityReviews /></Suspense>

      <section className="human-audit" aria-labelledby="human-audit-heading">
        <h2 id="human-audit-heading">{lang === "sv" ? "Vill du att en människa granskar ditt repo?" : "Want a human to review your repo?"}</h2>
        <p>
          <a href="https://buy.stripe.com/bJe9ASculcZgcKQ52R8og2w" target="_blank" rel="noopener noreferrer">
            {lang === "sv" ? "Mänsklig granskning av ett repo, €149" : "Human-reviewed audit of one repo, €149"}
            <span className="sr-only"> ({lang === "sv" ? "öppnas i en ny flik" : "opens in a new tab"})</span>
          </a>
        </p>
        <p><Link href="/partners">{lang === "sv" ? "Byråpartner" : "Agency partners"}</Link></p>
      </section>

      <footer className="footer">
        <span>DeployDoctor</span>
        <span>{t("home.footerNote")} <Link href="/guides">{t("nav.guides")}</Link></span>
        <a href="https://github.com/jonjys/deploydoctor/blob/master/LICENSE" rel="noopener">{t("footer.license")}</a>
        <LegalLinks />
      </footer>
    </main>
  );
}

