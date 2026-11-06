import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED, OPERATOR, OPERATOR_LINE } from "@/lib/operator";

export const metadata: Metadata = {
  title: "Privacy policy | DeployDoctor",
  description: "What DeployDoctor stores, who else receives it, how long it is kept and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

const privacy = <a href={`mailto:${OPERATOR.email.privacy}`}>{OPERATOR.email.privacy}</a>;

export default function PrivacyPage() {
  return <main className="site-shell"><SiteNav /><article className="guide legal-page">
    <p className="section-kicker">LEGAL</p>
    <h1>Privacy policy</h1>
    <p className="guide-lead">What DeployDoctor stores, who else receives it, how long it is kept and how to have it deleted. Last updated {LEGAL_UPDATED}.</p>

    <h2>Who is responsible</h2>
    <p>{OPERATOR_LINE} Nytto Labs is the controller for the personal data described here. Write to {privacy} about anything on this page.</p>

    <h2>Scans and reports</h2>
    <ul>
      <li><strong>Public repositories.</strong> A scan saves a report with the repository address (which includes the owner&apos;s GitHub name), the commit, file paths, line numbers and the findings. Secret values the scanner finds are masked to their type and last four characters. Reports of public repositories are public: anyone with the link can open them, search engines may index them, and the latest report for a repository can be found by its name through the score page and the README badge.</li>
      <li><strong>Private repositories.</strong> The report is stored privately with your Stripe customer ID and opens only in the browser you paid in or with your API token.</li>
      <li><strong>Scan history.</strong> When you scan with a pass or subscription, the report ID, repository and date are kept with your Stripe customer ID.</li>
      <li><strong>GitHub access.</strong> A GitHub token you paste or a GitHub connection you approve is kept only in an encrypted cookie in your browser for at most 8 hours, and is never written to our database. The fix app writes only the branch, commit and pull request it describes.</li>
    </ul>

    <h2>Purchases</h2>
    <p>Payments are processed by Stripe; DeployDoctor never sees your card details. After a purchase we store your email address, your Stripe customer ID, the plan, its status and when it ends, and anything you typed in the optional checkout field. For a fix pull request we store the repository, commit and pull request address, and, if you give them, your live site address, a short error summary and whether you agreed to the public Rescue Wall. The Rescue Wall shows the repository name, error summary, live address and pull request only for fixes whose owners agreed and whose build passed.</p>

    <h2>What you type in</h2>
    <ul>
      <li><strong>AI build-log diagnosis.</strong> The log you paste is sent to Anthropic&apos;s Claude for analysis. Before it leaves our server, keys and tokens in known formats (Stripe, OpenAI, Anthropic, AWS, GitHub, Supabase and other JWTs, private keys) are masked. DeployDoctor does not store the log; your browser keeps the last diagnosis for the current tab. Masking covers keys, not personal data, so remove names and email addresses from a log before you paste it.</li>
      <li><strong>Watch this repo.</strong> We store your email address and the repository, send a confirmation email and then an alert only when new problems appear. Unconfirmed sign-ups are deleted after 7 days. After you unsubscribe no more email is sent, and the address stays on record, marked unsubscribed, until you ask us to delete it.</li>
      <li><strong>Reviews and ideas.</strong> We store the name, text and rating you submit. A review is shown publicly (name, text, rating and date) only if you agreed and it has been approved. Ideas are never published.</li>
      <li><strong>&quot;Did this solve it?&quot;</strong> Your answer is stored with a hashed identifier, and only the count is shown.</li>
    </ul>

    <h2>Live site check and leak check</h2>
    <p>We fetch the site you enter the way a browser would: its homepage, its JavaScript files, robots.txt and a few well-known policy addresses. Nothing about the site is saved. If its footer shows an EU VAT number, that number is sent once to the European Commission&apos;s VIES service to check it.</p>

    <h2>IP addresses</h2>
    <p>Your IP address is never stored. A keyed hash of it is used to enforce daily limits and stop abuse, and only that hash is kept in the usage counters.</p>

    <h2>Cookies and browser storage</h2>
    <p>DeployDoctor sets no advertising or tracking cookies. Every cookie below is needed for something you asked for, or remembers a choice you made.</p>
    <ul>
      <li><code>dd_customer</code>: remembers that this browser paid, for 90 days.</li>
      <li><code>dd_checkout</code>: ties a checkout to the browser that started it, for 24 hours.</li>
      <li><code>dd_patch_access</code>: recovery keys for patches you bought, for 1 year.</li>
      <li><code>dd_github</code>, <code>dd_github_flow</code>, <code>dd_github_install</code>, <code>dd_fix_flow</code>, <code>dd_fix_token</code>, <code>dd_fix_install</code>: an encrypted GitHub connection, for at most 8 hours (set-up steps 10 minutes).</li>
      <li><code>dd_review_owner</code>: lets this browser edit its own review, for 1 year.</li>
      <li><code>dd_lang</code>: your language, for 1 year.</li>
    </ul>
    <p>Your browser&apos;s local storage holds your recently opened reports, your &quot;did this solve it&quot; answers and the checks you chose to hide; session storage holds your last diagnosis. None of it is sent to us. Page views are counted with Vercel Web Analytics, which does not use cookies.</p>

    <h2>Who else receives data</h2>
    <ul>
      <li>Vercel: hosting and cookieless page-view statistics.</li>
      <li>Supabase: the database.</li>
      <li>Stripe: payments, subscriptions and refunds.</li>
      <li>GitHub: reading repositories, and opening pull requests you ask for.</li>
      <li>Anthropic: AI build-log diagnosis.</li>
      <li>Resend: the watch-this-repo emails.</li>
      <li>The European Commission (VIES): VAT numbers found by the live site check.</li>
    </ul>
    <p>Several of these companies are based in the United States. Transfers rely on the EU Standard Contractual Clauses or the EU-US Data Privacy Framework, as set out in each provider&apos;s data processing terms.</p>

    <h2>How long data is kept</h2>
    <p>Reports, purchase records, scan history, reviews and votes are kept until you ask us to delete them. Accounting records are kept as long as Swedish bookkeeping law requires, which is seven years. Unconfirmed watch sign-ups are deleted after 7 days, and cached scan results after two minutes.</p>

    <h2>Why we may use it</h2>
    <p>To deliver what you ask for and buy (contract); to keep the service secure, enforce fair-use limits, publish reports of public repositories and improve the checks (legitimate interests); to send watch emails, publish reviews and list fixes on the Rescue Wall (your consent, which you can withdraw); and to keep accounts (legal obligation).</p>

    <h2>Your rights</h2>
    <p>You can ask for a copy of your data, and have it corrected, deleted, restricted or moved, and you can object to its use or withdraw consent. Write to {privacy} with the report URL or the email address you paid with. If you are unhappy with the answer, you can complain to the Swedish Authority for Privacy Protection (<a href="https://www.imy.se">IMY</a>) or the data protection authority where you live.</p>

    <p className="plugin-line">The AI plugin has its own <Link href="/ai-plugin#privacy">plugin privacy notice</Link>. <Link href="/terms">Terms</Link> · <Link href="/refunds">Refund policy</Link></p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
