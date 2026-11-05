import type { Metadata } from "next";
import Link from "next/link";
import { CopyTextButton } from "@/components/copy-text-button";
import { PartnerDesk, type PartnerDeskLabels } from "@/components/partner-desk";
import { SiteNav } from "@/components/site-nav";
import { HUMAN_AUDIT_PAYMENT_URL, PARTNER_SUPPORT_EMAIL, partnerAuditUrl, partnerFallbackMailto } from "@/lib/human-audit";
import { getT } from "@/lib/lang";

const EXAMPLE_SLUG = "acme";
const EXAMPLE_URL = partnerAuditUrl(EXAMPLE_SLUG)!;

const copy = {
  en: {
    title: "Agency partners — €49 Vercel deploy audit | DeployDoctor",
    description: "Agencies share a Stripe Payment Link. When a client pays €49 for a human audit of one repository within 48 hours, the agency earns 30 percent, paid manually.",
    kicker: "AGENCY PARTNERS",
    h1: "Send clients whose Vercel deploys break. Earn 30%.",
    lead: "Share a payment link. Your client pays €49 for a human review of one repository, within 48 hours. You earn 30% (about €15), paid manually offline. This program does not use Stripe Connect or automatic payouts.",
    how: "How it works",
    steps: [
      { title: "Send the link", detail: "Give the client the payment link below, with your agency slug in client_reference_id." },
      { title: "They pay €49", detail: "Stripe charges €49. A person reviews one repository and replies within 48 hours of payment." },
      { title: "You earn 30%", detail: "About €15 per paid audit, paid by hand after the payment shows up. We match the slug. Nothing is transferred automatically." },
    ],
    linkTitle: "The payment link",
    base: "Base link, with no agency tracking:",
    example: `Same link with an example slug (${EXAMPLE_SLUG}). Replace ${EXAMPLE_SLUG} with the slug we confirm for you:`,
    reference: "Append ?client_reference_id=YOUR_SLUG. Stripe stores that value on the payment so we can see which agency sent the buyer. It does not change the €49 price and it is not a coupon. Use 2–64 characters: lowercase letters, numbers, and hyphens. Email us the slug before you share the link. Stripe allows up to 200 characters; a short slug is easier to match when we pay you.",
    separate: "Separate from scan pricing",
    separateItems: [
      "Automated scan passes stay at $2 for 24 hours, $5 for 7 days, and $9 a month. This page does not change those prices.",
      "A fix pull request stays $5. This offer is only the human audit.",
      "There is no partner dashboard. Payouts are manual and offline.",
    ],
    fallbackBefore: "The form opens your email app addressed to",
    fallbackAfter: "with the subject Partner and your agency name. This site does not store what you type. Do not email repository secrets.",
    copyLabel: "Copy link",
    copied: "Copied",
    desk: {
      slug: "Slug you will use",
      slugHint: "Example: acme or northwind-studio. We confirm it by email before you send clients.",
      tracked: "Your link",
      invalidSlug: "Use 2–64 characters: lowercase letters, numbers, and hyphens. It cannot start or end with a hyphen.",
      copy: "Copy link",
      copied: "Copied",
      signupTitle: "Tell us your agency",
      signupLead: "We reply from support@nyttolabs.com to confirm the slug. Then you can share the link.",
      agency: "Agency name",
      email: "Your email",
      website: "Website (optional)",
      submit: "Email support@nyttolabs.com",
      errorAgency: "Enter an agency name.",
      errorEmail: "Enter an email address.",
      errorSlug: "Enter a slug of 2–64 characters: lowercase letters, numbers, and hyphens.",
    } satisfies PartnerDeskLabels,
  },
  sv: {
    title: "Byråpartner — granskning av Vercel-deploy för €49 | DeployDoctor",
    description: "Byråer delar en Stripe-betalningslänk. När en kund betalar €49 för en mänsklig granskning av ett repo inom 48 timmar får byrån 30 procent, utbetalt manuellt.",
    kicker: "BYRÅPARTNER",
    h1: "Skicka kunder vars Vercel-deploys går sönder. Tjäna 30 %.",
    lead: "Dela en betalningslänk. Kunden betalar €49 för en mänsklig granskning av ett repo, inom 48 timmar. Du får 30 % (cirka €15), utbetalt manuellt. Programmet använder inte Stripe Connect och gör inga automatiska utbetalningar.",
    how: "Så fungerar det",
    steps: [
      { title: "Skicka länken", detail: "Ge kunden betalningslänken nedan, med din byrås slug i client_reference_id." },
      { title: "De betalar €49", detail: "Stripe tar €49. En person granskar ett repo och svarar inom 48 timmar efter betalningen." },
      { title: "Du tjänar 30 %", detail: "Cirka €15 per betald granskning, utbetalt för hand när betalningen syns. Vi matchar slugen. Inget förs över automatiskt." },
    ],
    linkTitle: "Betalningslänken",
    base: "Grundlänk, utan byråspårning:",
    example: `Samma länk med ett exempel på slug (${EXAMPLE_SLUG}). Byt ut ${EXAMPLE_SLUG} mot slugen vi bekräftar åt dig:`,
    reference: "Lägg till ?client_reference_id=DIN_SLUG. Stripe sparar värdet på betalningen så att vi ser vilken byrå som skickade köparen. Det ändrar inte priset €49 och det är ingen rabattkod. Använd 2–64 tecken: små bokstäver, siffror och bindestreck. Mejla oss slugen innan du delar länken. Stripe tillåter upp till 200 tecken; en kort slug är lättare att matcha när vi betalar dig.",
    separate: "Separat från skanningspriserna",
    separateItems: [
      "Skanningspassen ligger kvar på $2 i 24 timmar, $5 i 7 dagar och $9 i månaden. Den här sidan ändrar inte de priserna.",
      "En fix-pull-request kostar $5. Det här erbjudandet gäller bara den mänskliga granskningen.",
      "Det finns ingen partnerpanel. Utbetalningar sker manuellt.",
    ],
    fallbackBefore: "Formuläret öppnar ditt mejlprogram till",
    fallbackAfter: "med ämnet Partner och byråns namn. Sidan sparar inte det du skriver. Mejla inga hemligheter från repot.",
    copyLabel: "Kopiera länk",
    copied: "Kopierad",
    desk: {
      slug: "Slug du kommer använda",
      slugHint: "Exempel: acme eller northwind-studio. Vi bekräftar den via mejl innan du skickar kunder.",
      tracked: "Din länk",
      invalidSlug: "Använd 2–64 tecken: små bokstäver, siffror och bindestreck. Den får inte börja eller sluta med bindestreck.",
      copy: "Kopiera länk",
      copied: "Kopierad",
      signupTitle: "Berätta om byrån",
      signupLead: "Vi svarar från support@nyttolabs.com och bekräftar slugen. Sedan kan du dela länken.",
      agency: "Byråns namn",
      email: "Din e-post",
      website: "Webbplats (valfritt)",
      submit: "Mejla support@nyttolabs.com",
      errorAgency: "Ange byråns namn.",
      errorEmail: "Ange en e-postadress.",
      errorSlug: "Ange en slug med 2–64 tecken: små bokstäver, siffror och bindestreck.",
    } satisfies PartnerDeskLabels,
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getT();
  const text = copy[lang];
  return {
    title: text.title,
    description: text.description,
    alternates: { canonical: "/partners" },
    openGraph: { title: text.title, description: text.description, url: "/partners", type: "website" },
  };
}

export default async function PartnersPage() {
  const { lang } = await getT();
  const text = copy[lang];
  const fallback = partnerFallbackMailto();
  return (
    <main className="site-shell">
      <SiteNav />
      <article className="guide">
        <p className="section-kicker">{text.kicker}</p>
        <h1>{text.h1}</h1>
        <p className="guide-lead">{text.lead}</p>
        <h2>{text.how}</h2>
        <ol>
          {text.steps.map((step) => (
            <li key={step.title}><strong>{step.title}.</strong> {step.detail}</li>
          ))}
        </ol>
        <h2>{text.linkTitle}</h2>
        <p>{text.base}</p>
        <pre><code>{HUMAN_AUDIT_PAYMENT_URL}</code></pre>
        <p className="ci-copy"><CopyTextButton text={HUMAN_AUDIT_PAYMENT_URL} label={text.copyLabel} copiedLabel={text.copied} compact /></p>
        <p>{text.example}</p>
        <pre><code>{EXAMPLE_URL}</code></pre>
        <p className="ci-copy"><CopyTextButton text={EXAMPLE_URL} label={text.copyLabel} copiedLabel={text.copied} compact /></p>
        <p>{text.reference}</p>
        <h2>{text.separate}</h2>
        <ul>
          {text.separateItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>
          <Link href="/pricing">{lang === "sv" ? "Skanningspriser" : "Scan pricing"}</Link>
          {" · "}
          <Link href="/">{lang === "sv" ? "Skanna ett repo" : "Scan a repository"}</Link>
        </p>
        <PartnerDesk labels={text.desk} />
        <p>
          {text.fallbackBefore}{" "}
          <a href={fallback}>{PARTNER_SUPPORT_EMAIL}</a>{" "}
          {text.fallbackAfter}
        </p>
      </article>
    </main>
  );
}
