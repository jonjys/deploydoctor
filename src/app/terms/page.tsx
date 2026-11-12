import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED, OPERATOR, OPERATOR_LINE } from "@/lib/operator";
import { plans } from "@/lib/plans";
import { FREE_SCANS_PER_DAY } from "@/lib/limits";
import { pageMetadata, pages } from "@/lib/seo";

export const metadata = pageMetadata(pages.terms);

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
    <p>{FREE_SCANS_PER_DAY === 1 ? "One public repository scan" : `${FREE_SCANS_PER_DAY} public repository scans`} per UTC day per IP address (shared by everyone on that address, and also used by the command-line tool, the AI plugin&apos;s repository scan and the Webhook Replay Lab code review), plus one free GitHub Action scan a day per public repository. The live site check, the leak check and up to 3 AI build-log diagnoses a day are free. All use, free and paid, is subject to rate and capacity limits.</p>

    <h2>4. What you can buy</h2>
    <ul>
      <li><strong>{plans.day.name}</strong>: {usd(plans.day.amount)}, one payment. Unlimited scans, including private repositories, for 24 hours, on the website in a browser that holds the purchase and with your API token (not through the AI plugin), {limits}. It does not renew.</li>
      <li><strong>{plans.week.name}</strong>: {usd(plans.week.amount)}, one payment. The same for 7 days. It does not renew.</li>
      <li><strong>Monthly</strong>: {usd(plans.public.amount)} a month, a subscription with the same scans plus a scan history, renewed every month until you cancel it. <strong>Private</strong>, {usd(plans.private.amount)} a month, is a subscription on the same terms; it is no longer listed on the pricing page.</li>
      <li><strong>Verified import patch</strong>: $5, one payment, for a git patch that corrects the import letter-case problems DeployDoctor can verify in a saved report of a public repository. Import problems it found but cannot fix are listed before you pay. Only the first 12 files with import findings, each under 256 KB, are examined, so problems in other files are neither fixed nor listed; compare the patch with the report. The offer expires 24 hours after it is made, and checkout must be started at least 30 minutes before then. You review and apply it yourself. You can also have it opened as a draft pull request with your own GitHub token, which needs write access to the repository; this works only while the default branch is still at the commit the patch was made for. Otherwise, download the patch.</li>
      <li><strong>Fix pull request</strong>, when offered: $5, one payment. The first 50 fix pull requests DeployDoctor opens, counted across all customers, are free. Before you pay, you connect GitHub and install the DeployDoctor Fix GitHub App with write access to the repository. DeployDoctor then opens a regular (not draft) pull request with the changes listed before you pay, based on a static scan of your default branch, which must still be at the scanned commit. Changes marked Verified were checked against that commit. Steps marked Instructions are not code changes and do not change the build by themselves: if the pull request contains no code change they are written to deploydoctor-fix.md, otherwise they appear only in the pull request description. Open the pull request within 24 hours of starting checkout: after that a paid fix without a pull request is refunded and can no longer be opened. If Vercel reports that its build of the commit DeployDoctor made has failed, the $5 is refunded automatically; if your project is not built by Vercel, Vercel reports no result, you push another commit, or only your own checks fail, write to {support} and we will look at it (see the refund policy).</li>
      <li><strong>Human-reviewed repository audit</strong> (Vercel Deploy Audit), no longer sold: these terms and the refund policy cover audits bought through its Stripe payment link (€149, charged in euros). After payment you gave read access to one repository by inviting the GitHub user jonjys with the Read role, and the report arrives by email within 48 hours. Remove the access whenever you like; no copy of your code is kept.</li>
    </ul>
    <p>Prices are in US dollars and include any VAT; nothing is added at checkout, and Stripe charges the amount shown. The audit was priced in euros through a Stripe payment link, and Stripe may have charged it in your card&apos;s currency at its own rate. Kronor figures on the Swedish pages are a rounded guide; if your card is in another currency, your bank sets the exchange rate. Current prices are on the <Link href="/pricing">pricing page</Link>.</p>

    <h2>5. Passes and subscriptions</h2>
    <p>A pass runs for 24 hours or 7 days from the moment you open Stripe Checkout (not from when the payment clears) and then ends by itself; there is nothing to cancel. Cancel a subscription at any time with &quot;Manage / cancel subscription&quot; on <Link href="/account">your account page</Link>, which opens Stripe&apos;s billing portal: it stops the next renewal, and access continues until the end of the period already paid for.</p>
    <p>Paid access is remembered for 90 days in the browser where you started and completed checkout. After that, or in another browser, restore it on the <Link href="/restore">restore page</Link> with your checkout email and payment reference (the cs_ code in the address of the thank-you page). A patch is restored with its payment reference and recovery key instead.</p>
    <p>API tokens expire after one year and cannot be revoked one by one, and creating a new token does not cancel older ones. While you have an active pass or subscription, anyone holding your token can scan as you, and those scans are saved to your account. Until the token expires, even after your pass has ended, they can also download any of your private reports whose link or ID they have. Keep it secret.</p>

    <h2>6. Patches and fix pull requests</h2>
    <p>A patch is delivered immediately after payment, with a recovery key. A fix pull request is opened when you press the button after payment and changes only the files it lists; nothing is merged for you. Review every change before you merge it. When a fix pull request is refunded is set out in the <Link href="/refunds">refund policy</Link>.</p>

    <h2>7. Your responsibilities</h2>
    <p>Scan only repositories, and check only sites, that you own or are allowed to inspect. Do not paste credentials or personal data you do not need to, do not try to get around the limits, and do not use DeployDoctor to attack or overload anyone&apos;s systems. Reports of public repositories are public (see the <Link href="/privacy">privacy policy</Link>).</p>

    <h2>8. Liability</h2>
    <p>DeployDoctor is provided with care but without a guarantee that it finds every problem or that a fix makes a deploy pass, except where these terms, the refund policy or the offer you accepted at checkout promise money back. Our liability for a purchase is limited to what you paid for it. Nothing in these terms limits liability that cannot be limited by law, or your statutory rights as a consumer.</p>

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
