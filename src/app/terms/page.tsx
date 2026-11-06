import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED, OPERATOR, OPERATOR_LINE } from "@/lib/operator";
import { plans } from "@/lib/plans";
import { FREE_SCANS_PER_DAY } from "@/lib/limits";

export const metadata: Metadata = {
  title: "Terms of sale and use | DeployDoctor",
  description: "What DeployDoctor sells, how passes, subscriptions, patches and fix pull requests work, and what is and is not promised.",
  alternates: { canonical: "/terms" },
};

const usd = (cents: number) => `$${cents / 100}`;
const support = <a href={`mailto:${OPERATOR.email.support}`}>{OPERATOR.email.support}</a>;

export default function TermsPage() {
  return <main className="site-shell"><SiteNav /><article className="guide legal-page">
    <p className="section-kicker">LEGAL</p>
    <h1>Terms of sale and use</h1>
    <p className="guide-lead">What DeployDoctor sells and on what terms. Last updated {LEGAL_UPDATED}.</p>

    <h2>1. Who you are dealing with</h2>
    <p>DeployDoctor is operated by {OPERATOR_LINE} Contact: {support}.</p>

    <h2>2. What DeployDoctor does</h2>
    <p>DeployDoctor reads a repository through GitHub&apos;s API, or a live site the way a browser does, and reports problems it can find by static analysis. It does not clone, install, build or run your code. A finding is evidence to review, not a guarantee that a deploy will or will not succeed, and it is not a security certification or legal advice.</p>

    <h2>3. Free use</h2>
    <p>{FREE_SCANS_PER_DAY === 1 ? "One repository scan" : `${FREE_SCANS_PER_DAY} repository scans`} a day per connection, the live site check and the leak check are free, and so is a limited number of AI build-log diagnoses. Free use is subject to rate and capacity limits.</p>

    <h2>4. What you can buy</h2>
    <ul>
      <li><strong>{plans.day.name}</strong>: {usd(plans.day.amount)}, one payment. Unlimited scans, including private repositories, for 24 hours. It does not renew.</li>
      <li><strong>{plans.week.name}</strong>: {usd(plans.week.amount)}, one payment. The same for 7 days. It does not renew.</li>
      <li><strong>Monthly</strong>: {usd(plans.public.amount)} a month, a subscription that renews every month until you cancel it, and adds a scan history.</li>
      <li><strong>Verified import patch</strong>: $5, one payment, for a patch that fixes the import letter-case problems in a saved report. You review and apply it yourself.</li>
      <li><strong>Fix pull request</strong>, when offered: $5, one payment, for a pull request that DeployDoctor opens in your repository with the verified fix for a diagnosed failed deploy.</li>
    </ul>
    <p>Prices are in US dollars and Stripe charges the dollar amount. Kronor figures on the Swedish pages are a rounded guide; your bank sets the exact rate. The price is always shown before you pay. Current prices are on the <Link href="/pricing">pricing page</Link>.</p>

    <h2>5. Passes and subscriptions</h2>
    <p>A pass runs for 24 hours or 7 days from checkout and then ends by itself; there is nothing to cancel. Cancel a subscription at any time from <Link href="/account">your account</Link>, through Stripe&apos;s billing portal: it then ends at the close of the period you have paid for. Paid access is remembered in the browser where you completed checkout; in another browser, restore it with your checkout email and payment reference. API tokens work while a pass or subscription is active.</p>

    <h2>6. Patches and fix pull requests</h2>
    <p>A patch is delivered immediately after payment, with a recovery key. A fix pull request is opened when you press the button after payment and changes only the files it lists; nothing is merged for you. Review every change before you merge it. When the fix pull request is refunded is set out in the <Link href="/refunds">refund policy</Link>.</p>

    <h2>7. Your responsibilities</h2>
    <p>Scan only repositories, and check only sites, that you own or are allowed to inspect. Do not paste credentials or personal data you do not need to, do not try to get around the limits, and do not use DeployDoctor to attack or overload anyone&apos;s systems. Reports of public repositories are public (see the <Link href="/privacy">privacy policy</Link>).</p>

    <h2>8. Liability</h2>
    <p>DeployDoctor is provided with care but without a guarantee that it finds every problem or that a fix makes a deploy pass, except where the refund policy promises money back. Our liability for a purchase is limited to what you paid for it. Nothing in these terms limits liability that cannot be limited by law, or your statutory rights as a consumer.</p>

    <h2>9. Right of withdrawal and refunds</h2>
    <p>If you are a consumer in the EU, you can withdraw from a purchase within 14 days. See the <Link href="/refunds">refund policy</Link> for how, and for the refunds DeployDoctor makes automatically.</p>

    <h2>10. Purchases made elsewhere</h2>
    <p>The human-reviewed audit linked from the homepage is bought through its own Stripe payment link, and the Rescue Kit is sold on Gumroad. Their terms are those shown where you buy them.</p>

    <h2>11. Changes, law and disputes</h2>
    <p>We may change these terms for future purchases; the version shown when you paid applies to that purchase. These terms are governed by Swedish law. If you are a consumer, you keep the protection of the mandatory laws of the country you live in. Write to {support} first; consumers in Sweden can also turn to the National Board for Consumer Disputes (<a href="https://www.arn.se">ARN</a>).</p>

    <p className="plugin-line">The AI plugin has its own <Link href="/ai-plugin#terms">plugin usage terms</Link>.</p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
