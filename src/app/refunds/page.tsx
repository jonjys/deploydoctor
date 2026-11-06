import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/operator";

export const metadata: Metadata = {
  title: "Refund policy | DeployDoctor",
  description: "When DeployDoctor refunds automatically, your 14-day right of withdrawal, and how to ask for money back.",
  alternates: { canonical: "/refunds" },
};

const support = <a href={`mailto:${OPERATOR.email.support}`}>{OPERATOR.email.support}</a>;

export default function RefundsPage() {
  return <main className="site-shell"><SiteNav /><article className="guide legal-page">
    <p className="section-kicker">LEGAL · MONEY BACK</p>
    <h1>Refund policy</h1>
    <p className="guide-lead">Where software can tell that a purchase did not deliver, the refund is automatic. Otherwise, one email is enough. Last updated {LEGAL_UPDATED}.</p>

    <h2>Fix pull requests: no fix, no pay</h2>
    <ul>
      <li>If Vercel&apos;s build of the fix commit fails, the $5 is refunded automatically. If the refund has not arrived, press &quot;Build failed? Refund me&quot; on the order page.</li>
      <li>If GitHub refuses the pull request, the $5 is refunded at once.</li>
      <li>If a paid fix still has no pull request 24 hours after checkout, a daily check refunds it.</li>
      <li>Free launch fixes cost nothing, so there is nothing to refund.</li>
    </ul>

    <h2>Your 14-day right of withdrawal</h2>
    <p>If you are a consumer in the EU, you can withdraw from any purchase in DeployDoctor&apos;s own checkout (passes, subscriptions, patches and fix pull requests) within 14 days of buying it. Email {support} from the address you paid with, or include your payment reference, and say that you withdraw. The full amount is refunded within 14 days of your message.</p>

    <h2>Subscriptions after 14 days</h2>
    <p>Cancel at any time from <Link href="/account">your account</Link>. Cancelling stops the next payment and keeps access until the end of the period already paid for, which is not refunded.</p>

    <h2>Something went wrong</h2>
    <p>If you were charged and a pass did not activate, a patch did not apply to the commit it was made for, or anything else did not work as described, email {support} with the payment reference or order ID. It will be put right or refunded.</p>

    <h2>How refunds are paid</h2>
    <p>Refunds go back to the card or payment method you used, through Stripe, in US dollars. They usually appear within 5 to 10 business days; if your card is in another currency, your bank sets the exchange rate.</p>

    <h2>Not covered here</h2>
    <p>The human-reviewed audit (sold through its own Stripe payment link) and the Rescue Kit (sold on Gumroad) follow the terms shown where you buy them. See also the <Link href="/terms">terms</Link>.</p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
