import type { Metadata } from "next";
import Link from "next/link";
import { PartnerDesk, type PartnerDeskLabels } from "@/components/partner-desk";
import { SiteNav } from "@/components/site-nav";
import { CLIENT_REFERENCE_PARAM, PARTNER_SUPPORT_EMAIL, partnerFallbackMailto } from "@/lib/human-audit";
import { getT } from "@/lib/lang";
import { pageMetadata, partnerMeta } from "@/lib/seo";

const copy = {
  en: {
    kicker: "AGENCY PARTNERS",
    h1: "Send clients whose Vercel deploys break.",
    lead: "This page explains partner tracking. It does not publish a price, and it does not replace the audit link on the homepage.",
    how: "How tracking works",
    steps: [
      { title: "Tell us the slug", detail: "Email the agency name and the short slug you want to use." },
      { title: "We confirm it", detail: "After that email, we send the payment link. This page does not show one." },
      { title: "Add the reference", detail: `Append ?${CLIENT_REFERENCE_PARAM}=YOUR_SLUG to that link. Stripe stores the value on the payment so the agency can be matched. It is not a coupon and it does not change the price.` },
    ],
    linkTitle: "The reference",
    reference: `The query name is client_reference_id. A confirmed slug such as acme is added as ?${CLIENT_REFERENCE_PARAM}=acme. Use 2–64 characters: lowercase letters, numbers, and hyphens. Stripe allows up to 200 characters; a short slug is easier to match when the share is paid by hand.`,
    share: "The agency share is 30% of what the client pays, paid manually offline. Nothing is transferred automatically, and this program does not use Stripe Connect.",
    separate: "Separate from scan pricing",
    separateItems: [
      "Automated scan passes stay on the pricing page: $2 for 24 hours, $5 for 7 days, and $9 a month.",
      "This page does not sell a scan pass and does not publish an audit price.",
    ],
    fallbackBefore: "The form opens your email app addressed to",
    fallbackAfter: "with the subject Partner and your agency name. This site does not store what you type. Do not email repository secrets.",
    desk: {
      slug: "Slug you will use",
      slugHint: "Example: acme or northwind-studio. We confirm it by email before any link goes to a client.",
      tracked: "Reference to append",
      invalidSlug: "Use 2–64 characters: lowercase letters, numbers, and hyphens. It cannot start or end with a hyphen.",
      copy: "Copy reference",
      copied: "Copied",
      signupTitle: "Tell us your agency",
      signupLead: "We reply from support@nyttolabs.com to confirm the slug. The payment link is sent in that reply, not published here.",
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
    kicker: "BYRÅPARTNER",
    h1: "Skicka kunder vars Vercel-deploys går sönder.",
    lead: "Sidan förklarar partnerspårning. Den publicerar inget pris och ersätter inte granskningslänken på startsidan.",
    how: "Så fungerar spårningen",
    steps: [
      { title: "Berätta slugen", detail: "Mejla byråns namn och den korta slug du vill använda." },
      { title: "Vi bekräftar den", detail: "Efter det mejlet skickar vi betalningslänken. Den visas inte här." },
      { title: "Lägg till referensen", detail: `Lägg till ?${CLIENT_REFERENCE_PARAM}=DIN_SLUG på den länken. Stripe sparar värdet på betalningen så att byrån kan matchas. Det är ingen rabattkod och det ändrar inte priset.` },
    ],
    linkTitle: "Referensen",
    reference: `Parametern heter ${CLIENT_REFERENCE_PARAM}. En bekräftad slug som acme läggs till som ?${CLIENT_REFERENCE_PARAM}=acme. Använd 2–64 tecken: små bokstäver, siffror och bindestreck. Stripe tillåter upp till 200 tecken; en kort slug är lättare att matcha när andelen betalas för hand.`,
    share: "Byråns andel är 30 % av det kunden betalar, utbetalt manuellt. Inget förs över automatiskt, och programmet använder inte Stripe Connect.",
    separate: "Separat från skanningspriserna",
    separateItems: [
      "Skanningspassen ligger kvar på prissidan: $2 i 24 timmar, $5 i 7 dagar och $9 i månaden.",
      "Den här sidan säljer inget skanningspass och publicerar inget granskningspris.",
    ],
    fallbackBefore: "Formuläret öppnar ditt mejlprogram till",
    fallbackAfter: "med ämnet Partner och byråns namn. Sidan sparar inte det du skriver. Mejla inga hemligheter från repot.",
    desk: {
      slug: "Slug du kommer använda",
      slugHint: "Exempel: acme eller northwind-studio. Vi bekräftar den via mejl innan en länk går till en kund.",
      tracked: "Referens att lägga till",
      invalidSlug: "Använd 2–64 tecken: små bokstäver, siffror och bindestreck. Den får inte börja eller sluta med bindestreck.",
      copy: "Kopiera referens",
      copied: "Kopierad",
      signupTitle: "Berätta om byrån",
      signupLead: "Vi svarar från support@nyttolabs.com och bekräftar slugen. Betalningslänken kommer i det svaret, inte på den här sidan.",
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
  return pageMetadata({ ...partnerMeta[lang], path: "/partners" });
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
        <p>{text.reference}</p>
        <p><code>?{CLIENT_REFERENCE_PARAM}=AGENCY_SLUG</code></p>
        <p>{text.share}</p>
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
