import { Suspense } from "react";
import Link from "next/link";
import { RepoForm } from "@/components/repo-form";
import { EXAMPLE_REPORTS } from "@/lib/site";
import { allowsPrivate } from "@/lib/plans";
import { activePlan, customerSession } from "@/lib/access";
import { SiteNav } from "@/components/site-nav";
import { analysisText } from "@/lib/analysis-text";
import { getT } from "@/lib/lang";

export default async function Home() {
  const plan = await activePlan(await customerSession());
  const { lang, t } = await getT();
  const { titles } = analysisText(lang);
  // The same titles the analyzer prints, in report order. Supabase and Prisma only run when the stack uses them.
  const checks: Array<{ title: string; whenUsed?: boolean }> = [
    { title: titles.nextEntry }, { title: titles.imports }, { title: titles.serverLibs }, { title: titles.buildConfig },
    { title: titles.dependencies }, { title: titles.env }, { title: titles.secrets },
    { title: titles.supabase, whenUsed: true }, { title: titles.prisma, whenUsed: true },
  ];
  return (
    <main className="site-shell home-page">
      <SiteNav current="scan" />

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-icon">✦</span>
          {t("home.eyebrow")}
        </div>
        <h1>{t("home.h1")}</h1>
        <p className="hero-copy">{t("home.copy")}</p>

        <Suspense fallback={null}>
          <RepoForm privateAccess={allowsPrivate(plan?.plan)} />
        </Suspense>
        <div className="example-chips" aria-label={t("home.examples")}>
          <span>{t("home.examples")}</span>
          {EXAMPLE_REPORTS.map((example) => (
            <Link key={example.id} className={`example-chip is-${example.tone}`} href={`/r/${example.id}`}>
              <span className="chip-dot" aria-hidden="true" />{t(example.key)}
            </Link>
          ))}
        </div>

        <div className="trust-row" aria-label={t("home.trust.aria")}>
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
        <p className="plugin-line">
          <Link href="/ci">{t("home.ciLine")}</Link>
        </p>
        <p className="plugin-line">
          <Link href="/ai-plugin">{t("home.pluginLine")}</Link>
        </p>
      </section>

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
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <span>DeployDoctor</span>
        <span>{t("home.footerNote")} <Link href="/guides">{t("nav.guides")}</Link></span>
        <a href="https://github.com/jonjys/deploydoctor/blob/master/LICENSE" rel="noopener">{t("footer.license")}</a>
      </footer>
    </main>
  );
}
