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
      <li><strong>Public repositories.</strong> A scan saves a report with the repository address (which includes the owner&apos;s GitHub name), the commit, file paths, line numbers and the findings. Secret values in the formats the scanner recognises (Stripe live keys, AWS access key IDs, GitHub personal access tokens, Supabase secret keys and private keys) are masked to their prefix and last four characters, and a suggested .env.example also masks OpenAI and Anthropic keys and JWTs. A value in any other format, such as a password in a database URL, is not recognised and can appear as written. Reports of public repositories are public: anyone with the link can open them, search engines may index them, and the latest report for a repository can be found by its name through the score page and the README badge. A report stays published after the code changes; ask us to delete it.</li>
      <li><strong>Private repositories.</strong> The report is stored privately with your Stripe customer ID. It opens only in a browser that holds your purchase cookie (the browser you paid in, or one where you restored the purchase with its payment reference and your email) or with your API token, also after a pass has ended.</li>
      <li><strong>Scan history.</strong> Every scan made from a browser that holds your purchase cookie, or with your API token, is recorded with your Stripe customer ID: the report ID, the repository, the date and whether it was private. That includes free scans after a pass has ended. Only subscribers see this history under My scans.</li>
    </ul>

    <h2>GitHub access</h2>
    <ul>
      <li>A read-only GitHub token you paste, or a GitHub sign-in you approve for scanning, is kept only in an encrypted cookie in your browser for at most 8 hours and is never written to our database. A token you paste to open a patch pull request is used for that one request and not kept.</li>
      <li>If you install the DeployDoctor Fix GitHub App, it stays installed on your GitHub account until you uninstall it. While it is installed, DeployDoctor can create short-lived tokens with write access to the repositories you selected, the installation ID is stored with the Stripe checkout of a paid fix, and GitHub sends us commit status events for those repositories. We use those events only to see whether a fix commit&apos;s build passed. The app writes only the branch, commit and pull request it describes. Uninstall it on GitHub to end this access.</li>
    </ul>

    <h2>Purchases</h2>
    <p>Payments are processed by Stripe; DeployDoctor never sees your card details. After you buy a pass or subscription we store your email address, your Stripe customer ID, the plan, its status and when it ends. Stripe keeps the checkout details, which include the repository you were scanning when you bought (a private repository&apos;s name too) and anything you typed in the optional checkout field. For a patch or a fix pull request, Stripe also keeps the report ID and an encrypted copy of the patch, and for a fix any live site address, error summary, Rescue Wall choice and GitHub installation ID.</p>
    <p>For a fix pull request we store the repository, the diagnosed commit, our fix commit, the pull request address, whether the repository is private, the amount, the Stripe checkout and payment IDs and any refund ID. We also store a short error summary taken from our diagnosis, which also appears in the pull request description. If you give them, we store your live site address and whether you agreed to the public Rescue Wall, which shows the repository name, error summary, live address and pull request only for fixes whose owners agreed and whose build passed.</p>

    <h2>What you type in</h2>
    <ul>
      <li><strong>AI build-log diagnosis.</strong> The log you paste is sent to Anthropic&apos;s Claude for analysis. Before it leaves our server, these formats are masked: Stripe keys, OpenAI and Anthropic API keys, AWS access key IDs (not AWS secret keys), GitHub personal access tokens (ghp_ and github_pat_), Supabase secret keys, JWTs (Supabase keys included) and private keys. Passwords in database URLs, other tokens and personal data such as names and email addresses are not masked, so remove them before you paste. DeployDoctor does not store the log; your browser keeps the log, exactly as you pasted it, and its diagnosis until you close the tab.</li>
      <li><strong>Watch this repo.</strong> We store your email address and the repository, send a confirmation email and then an alert only when new problems appear. Unconfirmed sign-ups are deleted after 7 days. After you unsubscribe no more email is sent, and the address stays on record, marked unsubscribed, until you ask us to delete it.</li>
      <li><strong>Reviews and ideas.</strong> We store the name, text and rating you submit. A review is shown publicly (name, text, rating and date) only if you agreed and it has been approved. Ideas are never published.</li>
      <li><strong>&quot;Did this solve it?&quot;</strong> Your answer is stored with the report or diagnosis ID and the keyed hash of your IP address described below, so one visitor counts once. Only the total is shown.</li>
    </ul>

    <h2>Live site check and leak check</h2>
    <p>We fetch the site you enter from our server, identifying as DeployDoctor. We read its homepage, the JavaScript files it loads from the same host, robots.txt, a few usual policy addresses and two made-up addresses that show whether the site answers every address. We do not run its JavaScript, and nothing about the site is saved. If its footer shows an EU VAT number, that number is sent once to the European Commission&apos;s VIES service to check it.</p>

    <h2>IP addresses</h2>
    <p>DeployDoctor never writes your IP address to its database. A keyed hash of it, which stays the same from day to day, is used to enforce daily limits and stop abuse; that hash is kept in the daily usage counters and with any &quot;did this solve it&quot; answer. Our host, Vercel, receives your IP address with every request and may keep it briefly in its request logs.</p>

    <h2>Cookies and browser storage</h2>
    <p>DeployDoctor sets no advertising or tracking cookies. Every cookie below is needed for something you asked for, or remembers a choice you made.</p>
    <ul>
      <li><code>dd_customer</code>: your email address and Stripe customer ID, signed so they cannot be changed (not encrypted). It lets this browser use a purchase you made or restored, for 90 days.</li>
      <li><code>dd_checkout</code>: ties a checkout to the browser that started it, for 24 hours.</li>
      <li><code>dd_patch_access</code>: access keys for up to five patch offers you checked or bought, for 1 year.</li>
      <li><code>dd_github</code>, <code>dd_github_flow</code>, <code>dd_github_install</code>, <code>dd_fix_flow</code>, <code>dd_fix_token</code>, <code>dd_fix_install</code>: an encrypted GitHub connection, for at most 8 hours (set-up steps 10 minutes).</li>
      <li><code>dd_review_owner</code>: lets this browser edit its own review, for 1 year.</li>
      <li><code>dd_lang</code>: your language, for 1 year.</li>
    </ul>
    <p>Your browser&apos;s local storage holds your recently opened reports, your &quot;did this solve it&quot; answers and the checks you chose to hide; session storage holds your last pasted build log and its diagnosis. None of it is sent to us. Page views are counted with Vercel Web Analytics, which does not use cookies.</p>

    <h2>Who else receives data</h2>
    <ul>
      <li>Vercel: hosting, request logs and cookieless page-view statistics.</li>
      <li>Supabase: the database.</li>
      <li>Stripe: payments, subscriptions, refunds and the checkout details above.</li>
      <li>GitHub: reading repositories, opening pull requests you ask for, and build status events from the Fix app.</li>
      <li>Anthropic: AI build-log diagnosis.</li>
      <li>Resend: the watch-this-repo emails.</li>
      <li>The European Commission (VIES): VAT numbers found by the live site check.</li>
    </ul>
    <p>Several of these companies are based in the United States. Transfers rely on the EU Standard Contractual Clauses or the EU-US Data Privacy Framework, as set out in each provider&apos;s data processing terms.</p>

    <h2>How long data is kept</h2>
    <p>Reports, purchase and fix-order records, scan history, watches you have unsubscribed from, reviews, ideas and votes are kept until you ask us to delete them, and so are the daily usage counters keyed by the hash of your IP address. Accounting records are kept as long as Swedish bookkeeping law requires, which is seven years. Unconfirmed watch sign-ups are deleted after 7 days, and cached scan results after two minutes. Stripe, Vercel, Anthropic and Resend keep data under their own retention rules.</p>

    <h2>Why we may use it</h2>
    <p>To deliver what you ask for and buy (contract); to keep the service secure, enforce fair-use limits, publish reports of public repositories and improve the checks (legitimate interests); to send watch emails, publish reviews and list fixes on the Rescue Wall (your consent, which you can withdraw); and to keep accounts (legal obligation).</p>

    <h2>Your rights</h2>
    <p>You can ask for a copy of your data, and have it corrected, deleted, restricted or moved, and you can object to its use or withdraw consent. Write to {privacy} with the report URL or the email address you paid with. If you are unhappy with the answer, you can complain to the Swedish Authority for Privacy Protection (<a href="https://www.imy.se">IMY</a>) or the data protection authority where you live.</p>

    <p className="plugin-line">The AI plugin has its own <Link href="/ai-plugin#privacy">plugin privacy notice</Link>. <Link href="/terms">Terms</Link> · <Link href="/refunds">Refund policy</Link></p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
