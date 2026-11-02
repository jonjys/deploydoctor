import styles from "./revenue-bridge.module.css";

/**
 * A small, honest next step after the free scan.
 * Keep payments external: we do not handle card details here.
 */
export function RevenueBridge({ lang }: { lang: string }) {
  const sv = lang === "sv";
  return (
    <section className={styles.root} aria-labelledby="revenue-bridge-title">
      <div className={styles.intro}>
        <p className="section-kicker">{sv ? "EFTER DEN GRATIS SKANNINGEN" : "AFTER YOUR FREE SCAN"}</p>
        <h2 id="revenue-bridge-title">{sv ? "Vill du ha mer hjälp?" : "Need a hand with the next step?"}</h2>
        <p>{sv ? "Två valfria vägar vidare. Gratis skanning finns kvar ovan." : "Two optional ways to go further. The free scan is still right above."}</p>
      </div>
      <div className={styles.grid}>
        <article className={styles.offer}>
          <p className={styles.eyebrow}>{sv ? "FIXA DET SJÄLV" : "DO IT YOURSELF"}</p>
          <div className={styles.titleRow}>
            <h3>Vercel Deployment Rescue Kit</h3>
            <strong>$19</strong>
          </div>
          <p>{sv ? "14 sidors guide, redigerbar 42-punkters checklista och fem AI-prompter. Engelsk nedladdning, engångsköp." : "14-page playbook, editable 42-point checklist and five AI prompts. One-time download."}</p>
          <a className={styles.action} href="https://fieldworkstudio.gumroad.com/l/vercel-deployment-rescue-kit?utm_source=deploydoctor&utm_medium=website&utm_campaign=rescue_kit_bridge" target="_blank" rel="noopener noreferrer">
            {sv ? "Se Rescue Kit" : "Get the Rescue Kit"} <span aria-hidden="true">↗</span>
          </a>
        </article>
        <article className={styles.offer}>
          <p className={styles.eyebrow}>{sv ? "FÅ EN ANDRA BEDÖMNING" : "GET A SECOND OPINION"}</p>
          <div className={styles.titleRow}>
            <h3>{sv ? "Manuell granskning av ett repo" : "Human-reviewed repo audit"}</h3>
            <strong>€149</strong>
          </div>
          <p>{sv ? "För dig som vill att en människa granskar ett repo. En separat tjänst, inte en automatisk fix eller garanti för driften." : "Have a human review one repository. A separate service, not an automatic fix or an uptime guarantee."}</p>
          <a className={styles.action} href="https://buy.stripe.com/bJe9ASculcZgcKQ52R8og2w" target="_blank" rel="noopener noreferrer">
            {sv ? "Se granskningen" : "See the audit offer"} <span aria-hidden="true">↗</span>
          </a>
        </article>
      </div>
      <p className={styles.note}>{sv ? "Betalning sker hos Gumroad respektive Stripe. Inga köp eller resultat garanteras." : "Checkout is handled by Gumroad or Stripe. Neither option guarantees a successful deployment."}</p>
    </section>
  );
}
