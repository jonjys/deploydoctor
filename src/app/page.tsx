import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { RepoForm } from "@/components/repo-form";
import { ScanActivitySection } from "@/components/scan-activity-section";
import { CommunityReviews } from "@/components/community-reviews";
import { RecentScans } from "@/components/solved-prompt";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { EXAMPLE_REPORTS, SITE_URL } from "@/lib/site";
import { allowsPrivate } from "@/lib/plans";
import { activePlan, customerSession } from "@/lib/access";
import { reposScanned } from "@/lib/stats";
import { formatCount } from "@/lib/format-count";
import { getT } from "@/lib/lang";
import { fixPullRequestsEnabled } from "@/lib/fix-pr/github-app";
import styles from "./home-refresh.module.css";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const SCHEMA = { "@context": "https://schema.org", "@graph": [
  { "@type": "Organization", "@id": "https://nyttolabs.com/#org", name: "Nytto Labs", url: "https://nyttolabs.com", email: "support@nyttolabs.com",
    address: { "@type": "PostalAddress", addressLocality: "Tullinge", addressCountry: "SE" } },
  { "@type": "SoftwareApplication", name: "DeployDoctor", url: SITE_URL, applicationCategory: "DeveloperApplication", operatingSystem: "Web",
    description: "Scans GitHub repositories for common Vercel deployment risks in imports, environment variables, dependencies and build configuration. Source code is read without being executed.",
    publisher: { "@id": "https://nyttolabs.com/#org" }, offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free daily scan and free live site check." } },
] };

export default async function Home() {
  const [plan, scanned] = await Promise.all([customerSession().then(activePlan), reposScanned()]);
  const { lang, t } = await getT();
  const sv = lang === "sv";
  const fixOn = fixPullRequestsEnabled();
  return <main className="site-shell home-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA).replace(/</g, "\\u003c") }} />
    <SiteNav current="scan" />
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.pulse}><span aria-hidden="true">●</span> {sv ? "FÖR DIG SOM BYGGER OCH LANSERAR" : "FOR BUILDERS WHO SHIP"}</div>
      <h1 id="hero-title">{sv ? <>Varför misslyckas din<br /><em>Vercel-deploy?</em></> : <>Why your deploy<br /><em>fails on Vercel.</em></>}</h1>
      <p className={styles.intro}>{sv ? "Gratis GitHub-skanning efter vanliga Vercel-fel i importer, miljövariabler och byggkonfiguration. Har builden redan misslyckats? Felsök loggen." : "Free GitHub repo scan for common Vercel build errors: missing modules, environment variables and build configuration. Already have a failed build? Diagnose the log."}</p>

      <div className={styles.scanner} id="scan-repository">
        <div className={styles.scannerHead}>
          <div><span className={styles.step}>01 / {sv ? "KOD" : "CODE"}</span><h2>{sv ? "Skanna ett GitHub repo" : "Scan a GitHub repo"}</h2></div>
          <span className={styles.free}>{sv ? "GRATIS START" : "START FREE"}</span>
        </div>
        <Suspense fallback={null}><RepoForm privateAccess={allowsPrivate(plan?.plan)} /></Suspense>
        <p className={styles.scannerNote}>{sv ? "Läser koden utan att köra den. Resultat med bevis och förslag på nästa steg." : "Reads repository source without running it. Evidence and suggested next steps, not a deployment guarantee."}</p>
      </div>
      <div className={styles.paths} aria-label={sv ? "Andra sätt att börja" : "Other starting points"}>
        <Link href="/safe" className={styles.path}>
          <span className={styles.step}>02 / {sv ? "LIVEAPP" : "LIVE APP"}</span>
          <span className={styles.pathTitle}>{sv ? "Är min app säker?" : "Is my app safe?"} <span aria-hidden="true">↗</span></span>
          <span className={styles.pathCopy}>{sv ? "Kolla synliga säkerhetsrisker på en publik webbplats." : "Check publicly visible risks on a live website."}</span>
        </Link>
        <Link href="/fix" className={styles.path}>
          <span className={styles.step}>03 / {sv ? "BYGGFEL" : "FAILED BUILD"}</span>
          <span className={styles.pathTitle}>{sv ? "Fixa en build" : "Fix a failed build"} <span aria-hidden="true">↗</span></span>
          <span className={styles.pathCopy}>{fixOn ? (sv ? "Diagnos gratis. Stödda pull request fixar kan köpas separat." : "Free diagnosis. Supported PR repairs offered separately.") : (sv ? "Gratis diagnos. Automatisk PR reparation kräver separat aktivering." : "Free diagnosis. Automated PR repair is not enabled yet.")}</span>
        </Link>
        <Link href="/ai-check" className={styles.path}>
          <span className={styles.step}>04 / AI</span>
          <span className={styles.pathTitle}>{sv ? "AI-check" : "AI check"} <span aria-hidden="true">↗</span></span>
          <span className={styles.pathCopy}>{sv ? "Klistra in text. Se om den ser skriven av en modell ut." : "Paste text. See if it looks model-written."}</span>
        </Link>
      </div>
      <p className={styles.scannerNote}>{sv ? "Builden failar och du måste skeppa i dag? Vi fixar den inom 24 timmar eller så får du pengarna tillbaka. " : "Build failing and you need to ship today? We fix it within 24 hours or you get a full refund. "}<a href="https://buy.stripe.com/bJebJ0eCt0cu3ag2UJ8og2I" target="_blank" rel="noopener noreferrer">{sv ? "Deploy Rescue, €49" : "Deploy Rescue, €49"} ↗</a></p>
      <div className={styles.trust}>
        <span>✓ {sv ? "Ingen kod körs vid repo skanning" : "No repository code executed"}</span>
        <span>✓ {sv ? "Tydliga gränser" : "Clear scan limitations"}</span>
        {scanned !== null && <span>{formatCount(lang, scanned)} {t("home.trust.scanned")}</span>}
      </div>
      <details className={styles.examples}>
        <summary>{sv ? "Visa exempelrapporter" : "See sample scan reports"} <span aria-hidden="true">⌄</span></summary>
        <div className={styles.exampleLinks}>{EXAMPLE_REPORTS.map(ex => <Link key={ex.id} href={`/r/${ex.id}`}>{t(ex.key)} ↗</Link>)}</div>
      </details>
    </section>

    <section className="guide-more" aria-label="Vercel deployment troubleshooting">
      <h2>{sv ? "Hitta ditt deployproblem" : "Find your Vercel deployment problem"}</h2>
      <p><Link href="/errors">Vercel errors and fixes</Link> · <Link href="/guides">Deployment guides</Link></p>
      <ul><li><Link href="/errors/prisma-p1001-supabase-vercel">Prisma P1001 with Supabase</Link></li><li><Link href="/errors/supabase-sb-secret-401">Supabase sb_secret returns 401</Link></li><li><Link href="/errors/lovable-vercel-build-failed">Lovable app will not build on Vercel</Link></li><li><Link href="/errors/bolt-vercel-build-failed">Bolt export fails on Vercel</Link></li><li><Link href="/errors/v0-vercel-build-failed">v0 works in preview but fails in production</Link></li></ul>
    </section>

    <div className={styles.returning}><RecentScans /></div>

    <section className={styles.roadmap} aria-labelledby="steps-title">
      <div><span className="section-kicker">{sv ? "EN TYDLIGARE PROCESS" : "A CLEARER WORKFLOW"}</span><h2 id="steps-title">{sv ? "Från problem till nästa åtgärd" : "From finding to next action"}</h2><p>{sv ? "Ingen oändlig lista med lika viktiga varningar." : "No wall of equally urgent warnings."}</p></div>
      <ol>
        <li><span>01</span><strong>{sv ? "Upptäck" : "Find"}</strong><p>{sv ? "Välj repo, liveapp eller bygglogg." : "Start with the repo, live app, or failed build."}</p></li>
        <li><span>02</span><strong>{sv ? "Prioritera" : "Prioritize"}</strong><p>{sv ? "Rapporten lyfter nästa konkreta steg först." : "See one next move before the full report."}</p></li>
        <li><span>03</span><strong>{sv ? "Verifiera" : "Verify"}</strong><p>{sv ? "Kör om kontrollen efter ändringen. Testa alltid riktiga driftsflöden själv." : "Rescan after a change. Verify real production behavior separately."}</p></li>
      </ol>
    </section>

    <section className={styles.options} aria-labelledby="options-title">
      <div className={styles.optionsTop}><div><span className="section-kicker">{sv ? "NÄR DU BEHÖVER MER" : "WHEN YOU NEED MORE"}</span><h2 id="options-title">{sv ? "Fortsätt på ditt sätt" : "Go further your way"}</h2></div><Link href="/pricing">{sv ? "Alla alternativ" : "See pricing"} ↗</Link></div>
      <div className={styles.offerGrid}>
        <div className={styles.offer}><span>{sv ? "FÖR FLER SKANNINGAR" : "FOR MORE SCANS"}</span><strong>$2</strong><h3>{sv ? "24 timmars pass" : "24 hour pass"}</h3><p>{sv ? "Fler skanningar under en dag. Engångsbetalning." : "More scans for one day. One time payment."}</p><ScanCheckoutButton plan="day">{sv ? "Se passet" : "Get a pass"} →</ScanCheckoutButton></div>
        <div className={styles.offer}><span>{sv ? "GÖR DET SJÄLV" : "DIY DEBUGGING"}</span><strong>$19</strong><h3>Vercel Rescue Kit</h3><p>{sv ? "Guide, checklista och återanvändbara AI prompter." : "A playbook, editable checklist and reusable AI prompts."}</p><a className={styles.offerLink} href="https://fieldworkstudio.gumroad.com/l/vercel-deployment-rescue-kit" target="_blank" rel="noopener noreferrer">{sv ? "Se paketet" : "Explore the kit"} ↗</a></div>
        <div className={styles.offer}><span>{sv ? "FIXAT PÅ 24 TIMMAR" : "FIXED IN 24 HOURS"}</span><strong>€49</strong><h3>Deploy Rescue</h3><p>{sv ? "En människa hittar orsaken och skickar fixen som pull request eller patch. Fortfarande rött efter fixen? Full återbetalning." : "A human finds the cause and sends the fix as a pull request or patch. Still failing after the fix? Full refund."}</p><a className={styles.offerLink} href="https://buy.stripe.com/bJebJ0eCt0cu3ag2UJ8og2I" target="_blank" rel="noopener noreferrer">{sv ? "Fixa min build" : "Get my build fixed"} ↗</a></div>
      </div>
    </section>

    <details className={styles.moreTools}>
      <summary><span><strong>{sv ? "Fler verktyg och resurser" : "More tools and resources"}</strong><small>{sv ? "CI, AI plugin, diagnoser, guider och statistik" : "CI, AI plugin, diagnosis, guides and statistics"}</small></span><span aria-hidden="true">+</span></summary>
      <div className={styles.resourceGrid}>
        <Link href="/ai-check">AI-check ↗</Link>
        <Link href="/site-check">Site Check ↗</Link>
        <Link href="/webhook-replay-lab">Webhook Replay Lab ↗</Link>
        <Link href="/launch-readiness">Launch Readiness ↗</Link>
        <Link href="/launch-manual">Launch Manual ↗</Link>
        <Link href="/ci">GitHub Action ↗</Link>
        <Link href="/ai-plugin">AI / MCP ↗</Link>
        <Link href="/guides">{t("nav.guides")} ↗</Link>
        <Link href="/stats">{t("nav.stats")} ↗</Link>
        <Link href="/platforms">{sv ? "Plattformar och täckning" : "Platforms and coverage"} ↗</Link>
        <Link href="/partners">{sv ? "Partners" : "Partners"} ↗</Link>
      </div>
    </details>
    <details className={styles.moreTools}>
      <summary><span><strong>{sv ? "Community och aktivitet" : "Community and recent activity"}</strong><small>{sv ? "Öppen statistik och användarfeedback" : "Public statistics and user feedback"}</small></span><span aria-hidden="true">+</span></summary>
      <Suspense fallback={null}><ScanActivitySection /></Suspense>
      <Suspense fallback={null}><CommunityReviews /></Suspense>
    </details>
    <footer className={styles.footer}>
      <Link href="/">DeployDoctor</Link>
      <span>{sv ? "Av NyttoLabs · Läs mer om begränsningarna i varje rapport." : "By NyttoLabs · Each report explains its limitations."}</span>
      <LegalLinks />
      <a href="https://launchbuff.com/products/deploydoctor-ztqlq6" target="_blank" rel="noopener noreferrer" title="Featured on LaunchBuff">
        <Image src="https://launchbuff.com/badge-featured-dark.svg" alt="Featured on LaunchBuff" width={256} height={80} unoptimized style={{ display: "block", maxWidth: "100%", height: "auto" }} />
      </a>
    </footer>
  </main>;
}
