import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { ScanCheckoutButton } from "@/components/scan-checkout-button";
import { WebhookReviewForm } from "./webhook-review";
import { ReplayLab } from "./replay-lab";
import styles from "./replay-lab.module.css";

const title = "Your webhook. Five failure cases. | DeployDoctor";
const description = "Review pasted Stripe webhook code with line evidence and download a regression-test scaffold. Explore retries and crash recovery in a free simulation.";
export const metadata = {
  title: "Stripe Webhook Code Review & Regression Tests | DeployDoctor",
  description,
  alternates: { canonical: "/webhook-replay-lab" },
  openGraph: { title, description, url: "/webhook-replay-lab", type: "website", images: [{ url: "/webhook-replay-lab/opengraph-image", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title, description, images: ["/webhook-replay-lab/opengraph-image"] },
};

export default function ReplayLabPage() {
  return <main className={`site-shell ${styles.page}`} lang="en">
    <SiteNav />
    <header className={styles.hero}>
      <p className="section-kicker">FREE TOOL · BREAK MY CHECKOUT</p>
      <h1>Your webhook.<br /><span>Five failure cases.</span></h1>
      <p>Find replay risks in your own webhook code. Get line evidence and a regression-test scaffold, without connecting GitHub.</p>
      <small>No Stripe keys or real payments. Code review is static; the example lab is a browser simulation.</small>
    </header>
    <WebhookReviewForm />
    <details className={styles.demo}><summary>Explore the original example: one payment, five deliveries</summary><ReplayLab /></details>
    <section className={styles.offer} aria-labelledby="next-step">
      <div><p className="section-kicker">NOW LOOK AT YOUR OWN CODE</p><h2 id="next-step">What does your webhook actually do?</h2><p>DeployDoctor reviews visible GitHub source for payment and deployment risks, with evidence to inspect. One free public repo scan a day. Static analysis does not execute your checkout or prove fulfillment works.</p></div>
      <div className={styles.actions}><Link className="cta-button" href="/?utm_source=replay-lab&utm_medium=tool#scan-repository">Scan your repo free →</Link><ScanCheckoutButton plan="day">Private repo? Get 24 hours · $2 →</ScanCheckoutButton><small>One-time payment. No renewal. Public and private scans; capacity and GitHub limits apply.</small><Link href="/pricing">See pass details</Link></div>
    </section>
    <section className={styles.notes} aria-labelledby="real-world">
      <h2 id="real-world">What this teaches. What still needs testing.</h2>
      <p>Stripe can deliver an event more than once. A process-local event-ID guard can forget after a restart, or claim an event and crash before doing the work. Two distinct event IDs can also refer to the same purchase.</p>
      <p>The third handler models a database transaction that commits a unique purchase key and a database access grant together. Here, the key represents a Checkout Session ID for one access grant. Pick a business key that fits your fulfillment operation. All three examples are simulated in browser memory; restarting the worker only clears the middle example.</p>
      <p>A real integration still needs signature verification using the raw body, paid-status checks, concurrency and failure tests, and durable recovery. A database transaction cannot undo an external email or shipment: use an appropriate outbox and idempotent worker. This demo does not test your application, event ordering or delayed payment methods.</p>
      <p>Read the primary sources: <a href="https://docs.stripe.com/webhooks#handle-duplicate-events">Stripe on duplicate events</a>{" · "}<a href="https://docs.stripe.com/events/manage-webhook-endpoints#process-undelivered-events">Recovery and retries</a>{" · "}<Link href="/launch-readiness">DeployDoctor launch checks</Link>.</p>
    </section>
    <footer className="footer"><Link href="/">DeployDoctor</Link><span>By NyttoLabs · Built to make the failure visible.</span></footer>
  </main>;
}
