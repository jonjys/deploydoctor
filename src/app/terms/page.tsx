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
const limits = "subject to fair-use rate and capacity limits, GitHub's own limits and the scanner's per-repository file and time limits (an incomplete scan is marked as partial)";

export default function TermsPage() {
  return <main className="site-shell"><SiteNav /><article className="guide legal-page">
    <p className="section-kicker">LEGAL</p>
    <h1>Terms of sale and use</h1>
    <p className="guide-lead">What DeployDoctor sells and on what terms. Last updated {LEGAL_UPDATED}.</p>

    <h2>1. Who you are dealing with</h2>
    <p>DeployDoctor is operated by {OPERATOR_LINE} Contact: {support}.</p>

    <h2>2. What DeployDoctor does</h2>
    <p>DeployDoctor reads a repository through GitHub&apos;s API, or fetches a live site, and reports problems it can find by static analysis. It does not clone, install, build or run your code. A finding is evidence to review, not a guarantee that a deploy will or will not succeed, and it is not a security certification or legal advice. The build-log diagnosis is different: the log you paste is sent to Anthropic&apos;s Claude, and its answer is AI-generated and may be wrong. Free diagnoses do not include the suggested code change.</p>

    <h2>3. Free use</h2>
    <p>{FREE_SCANS_PER_DAY === 1 ? "One public repository scan" : `${FREE_SCANS_PER_DAY} public repository scans`} per UTC day per IP address (shared by everyone on that address, and also used by the command-line tool), plus one free GitHub Action scan a day per public repository. The live site check, the leak check and up to 3 AI build-log diagnoses a day are free. All use, free and paid, is subject to rate and capacity limits.</p>

    <h2>4. What you can buy</h2>
    <ul>
      <li><strong>{plans.day.name}</strong>: {usd(plans.day.amount)}, one payment. Unlimited scans, including private repositories, for 24 hours, {limits}. It does not renew.</li>
      <li><strong>{plans.week.name}</strong>: {usd(plans.week.amount)}, one payment. The same for 7 days. It does not renew.</li>
      <li><strong>Monthly</strong>: {usd(plans.public.amount)} a month, a subscription with the same scans plus a scan history, renewed every month until you cancel it. Existing <strong>Private</strong> subscribers pay {usd(plans.private.amount)} a month on the same terms.</li>
      <li><strong>Verified import patch</strong>: $5, one payment, for a git patch that corrects the import letter-case problems DeployDoctor can verify in a saved report of a public repository. Any it cannot fix are listed before you pay, and the offer is valid for 24 hours. You review and apply it yourself, or have it opened as a draft pull request with your own GitHub token.</li>
      <li><strong>Fix pull request</strong>, when offered: $5, one payment (the first 50 are free), for a pull request DeployDoctor opens in your repository with the changes listed before you pay, based on a static scan of your default branch. Changes marked Verified were checked against that commit; steps marked Instructions are written to deploydoctor-fix.md and do not change the build by themselves.</li>
      <li><strong>Vercel Deploy Audit</strong>: €149, one payment, charged in euros through a Stripe payment link. A person reviews one repository you give read access to and sends a report by email within 48 hours.</li>
    </ul>
    <p>Prices are in US dollars (the audit in euros) and include any VAT; nothing is added at checkout, and Stripe charges the amount shown. Kronor figures on the Swedish pages are a rounded guide; if your card is in another currency, your bank sets the exchange rate. Current prices are on the <Link href="/pricing">pricing page</Link>.</p>

    <h2>5. Passes and subscriptions</h2>
    <p>A pass runs for 24 hours or 7 days from the moment you open Stripe Checkout (not from when the payment clears) and then ends by itself; there is nothing to cancel. Cancel a subscription at any time with &quot;Manage / cancel subscription&quot; on <Link href="/account">your account page</Link>, which opens Stripe&apos;s billing portal: it stops the next renewal, and access continues until the end of the period already paid for.</p>
    <p>Paid access is remembered for 90 days in the browser where you started and completed checkout. After that, or in another browser, restore it on the <Link href="/restore">restore page</Link> with your checkout email and payment reference (the cs_ code in the address of the thank-you page). A patch is restored with its payment reference and recovery key instead.</p>
    <p>API tokens work while a pass or subscription is active and expire after one year. A token cannot be revoked by itself: anyone holding it can scan as you whenever you have an active pass, so keep it secret.</p>

    <h2>6. Patches and fix pull requests</h2>
    <p>A patch is delivered immediately after payment, with a recovery key. A fix pull request is opened when you press the button after payment and changes only the files it lists; nothing is merged for you. Review every change before you merge it. When a fix pull request is refunded is set out in the <Link href="/refunds">refund policy</Link>.</p>

    <h2>7. Your responsibilities</h2>
    <p>Scan only repositories, and check only sites, that you own or are allowed to inspect. Do not paste credentials or personal data you do not need to, do not try to get around the limits, and do not use DeployDoctor to attack or overload anyone&apos;s systems. Reports of public repositories are public (see the <Link href="/privacy">privacy policy</Link>).</p>

    <h2>8. Liability</h2>
    <p>DeployDoctor is provided with care but without a guarantee that it finds every problem or that a fix makes a deploy pass, except where the refund policy promises money back. Our liability for a purchase is limited to what you paid for it. Nothing in these terms limits liability that cannot be limited by law, or your statutory rights as a consumer.</p>

    <h2>9. Right of withdrawal and refunds</h2>
    <p>If you are a consumer in the EU, you can withdraw from a purchase within 14 days. See the <Link href="/refunds">refund policy</Link> for how, and for the refunds DeployDoctor makes automatically.</p>

    <h2>10. The Rescue Kit</h2>
    <p>The Rescue Kit linked from the homepage is sold on Gumroad, under the terms shown there.</p>

    <h2>11. Changes, law and disputes</h2>
    <p>We may change these terms for future purchases. A purchase is governed by the version published on this page on the day you paid; earlier versions are available on request from {support}. These terms are governed by Swedish law. If you are a consumer, you keep the protection of the mandatory laws of the country you live in. Write to {support} first; consumers in Sweden can also turn to the National Board for Consumer Disputes (<a href="https://www.arn.se">ARN</a>).</p>

    <p className="plugin-line">The AI plugin has its own <Link href="/ai-plugin#terms">plugin usage terms</Link>.</p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
