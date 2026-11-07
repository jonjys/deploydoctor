import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/operator";

export const metadata: Metadata = {
  title: "Refund policy | DeployDoctor",
  description: "When DeployDoctor refunds a fix automatically, your 14-day right of withdrawal, and how to ask for money back.",
  alternates: { canonical: "/refunds" },
};

const support = <a href={`mailto:${OPERATOR.email.support}`}>{OPERATOR.email.support}</a>;

export default function RefundsPage() {
  return <main className="site-shell"><SiteNav /><article className="guide legal-page">
    <p className="section-kicker">LEGAL · MONEY BACK</p>
    <h1>Refund policy</h1>
    <p className="guide-lead">Fix pull requests are refunded automatically in the cases listed below. Every other refund, for passes, subscriptions, patches and the audit, is made by hand, and one email is enough. Last updated {LEGAL_UPDATED}.</p>

    <h2>Fix pull requests: automatic refunds</h2>
    <ul>
      <li>If Vercel reports that its build of the commit DeployDoctor made has failed, the $5 is refunded automatically. Only Vercel&apos;s result on that commit counts. If your project is not built by Vercel, Vercel reports no result, you push another commit to the branch, or only your own CI fails, nothing is refunded automatically: email {support} and we will look at it. Once Vercel has reported a passing build of that commit, the fix counts as delivered.</li>
      <li>If the refund has not arrived, open the page Stripe returned you to after payment (its address contains session_id=cs_), connect GitHub again if asked, and press &quot;Build failed? Refund me&quot;. If you no longer have that page, email {support} with the cs_ payment reference.</li>
      <li>If, when you press &quot;Open the pull request&quot;, it cannot be opened for a reason a retry will not fix (no access, the repository or branch is not found, the branch changed since the diagnosis, or the change is rejected), the $5 is refunded at once. Other failures can be retried.</li>
      <li>Open the pull request soon after paying. If a paid fix still has no pull request 24 hours after you started checkout, the next daily check refunds it, normally within two days. After that the pull request can no longer be opened. If you have not been refunded within three days, email {support}.</li>
      <li>Free launch fixes cost nothing, so there is nothing to refund.</li>
    </ul>

    <h2>Your 14-day right of withdrawal</h2>
    <p>If you are a consumer in the EU, you can withdraw from any purchase (passes, subscriptions, patches, fix pull requests and the human-reviewed repository audit) within 14 days of buying it. Email {support} from the address you paid with, or include your payment reference, and say that you withdraw. The full amount is refunded within 14 days of your message. If you withdraw from a subscription, it is cancelled at the same time and its access ends. Once a patch or fix pull request is refunded, it can no longer be downloaded or opened from DeployDoctor.</p>

    <h2>Subscriptions after 14 days</h2>
    <p>Cancel at any time with &quot;Manage / cancel subscription&quot; on <Link href="/account">your account page</Link>, which opens Stripe&apos;s billing portal. In another browser, <Link href="/restore">restore access</Link> first with your checkout email and payment reference, or email {support} and we will cancel it for you. Cancelling stops the next payment and keeps access until the end of the period already paid for, which is not refunded.</p>

    <h2>Something went wrong</h2>
    <p>If you were charged and a pass did not activate, a patch did not apply to the commit it was made for, or anything else did not work as described, email {support} with the payment reference or order ID. It will be put right or refunded.</p>

    <h2>How refunds are paid</h2>
    <p>Refunds go back to the card or payment method you used, through Stripe, in the currency you were charged: US dollars for everything bought in DeployDoctor&apos;s own checkout, and for the audit the currency its payment link charged. They usually appear within 5 to 10 business days. Kronor amounts on the Swedish pages are a rounded guide: you get back the amount you were charged, and if your card is in another currency your bank sets the exchange rate, so the amount on your statement can differ.</p>

    <h2>Not covered here</h2>
    <p>The Rescue Kit is sold on Gumroad, under the terms shown there. See also the <Link href="/terms">terms</Link>.</p>
    <footer className="footer"><span>DeployDoctor</span><LegalLinks /></footer>
  </article></main>;
}
