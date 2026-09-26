import { RepoForm } from "@/components/repo-form";
import Link from "next/link";
import { activePlan, customerSession } from "@/lib/access";
import { LangSwitch } from "@/components/lang";
import { analysisText } from "@/lib/analysis-text";
import { getT } from "@/lib/lang";

function PulseMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export default async function Home() {
  const plan = await activePlan(await customerSession());
  const { lang, t } = await getT();
  const { titles } = analysisText(lang);
  const checks = [titles.nextEntry, titles.imports, titles.serverLibs, titles.env, titles.supabase, titles.prisma];
  return (
    <main className="site-shell home-page">
      <nav className="topbar" aria-label="Primary navigation">
        <Link className="brand" href="/" aria-label="DeployDoctor home">
          <PulseMark />
          <span>DeployDoctor</span>
        </Link>
        <div className="nav-links"><Link href="/pricing">{t("nav.pricing")}</Link><Link href="/account">{t("nav.myScans")}</Link><LangSwitch /></div>
      </nav>

      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-icon">✦</span>
          {t("home.eyebrow")}
        </div>
        <h1>{t("home.h1")}</h1>
        <p className="hero-copy">{t("home.copy")}</p>

        <RepoForm privateAccess={plan?.plan === "private"} />

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
      </section>

      <section className="checks-panel" aria-labelledby="checks-heading">
        <div>
          <p className="section-kicker">{t("home.preflight")}</p>
          <h2 id="checks-heading">{t("home.checksHeading")}</h2>
        </div>
        <ol className="check-list">
          {checks.map((check, index) => (
            <li key={check}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {check}
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <span>DeployDoctor</span>
        <span>{t("home.footerNote")}</span>
      </footer>
    </main>
  );
}
