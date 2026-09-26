import "server-only";
import type Stripe from "stripe";
import { rpc } from "@/lib/db";
import { objectId, scanPlanForPrice, stripeClient } from "@/lib/stripe";
import { isPlan, isScanPlan } from "@/lib/plans";

export async function handleBillingEvent(event: Stripe.Event) {
  const stripe = stripeClient();
  let entitlement: Record<string, unknown> | null = null;
  let order: Record<string, unknown> | null = null;

  async function subscriptionState(id: string) {
    // Fetch current state: retries / out-of-order notifications cannot restore an old plan.
    const sub = await stripe.subscriptions.retrieve(id);
    const plan = scanPlanForPrice(sub.items.data[0]?.price.id);
    if (!plan || plan === "week" || sub.metadata.app !== "deploydoctor") return null;
    const customerId = objectId(sub.customer);
    if (!customerId) throw new Error("Missing customer");
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || !customer.email) throw new Error("Missing customer email");
    return { id: sub.id, email: customer.email.toLowerCase(), plan, status: sub.status,
      stripe_customer_id: customerId,
      current_period_end: new Date(Math.min(...sub.items.data.map((item) => item.current_period_end)) * 1000).toISOString() };
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const payload = event.data.object as Stripe.Checkout.Session;
      const session = await stripe.checkout.sessions.retrieve(payload.id, { expand: ["line_items"] });
      if (session.metadata?.app !== "deploydoctor" || session.payment_status !== "paid") return;
      const plan = session.metadata.plan;
      if (!isPlan(plan)) throw new Error("Unknown plan");
      const customerId = objectId(session.customer);
      const email = session.customer_details?.email?.toLowerCase();
      if (!customerId || !email) throw new Error("Missing checkout customer");
      if (session.mode === "subscription") {
        const subscriptionId = objectId(session.subscription);
        if (!subscriptionId) throw new Error("Missing subscription");
        entitlement = await subscriptionState(subscriptionId);
      } else if (plan === "week" && scanPlanForPrice(session.line_items?.data[0]?.price?.id ?? "") === "week") {
        entitlement = { id: session.id, email, plan, status: "active", stripe_customer_id: customerId,
          current_period_end: new Date((session.created + 7 * 86400) * 1000).toISOString() };
      } else if (!isScanPlan(plan)) {
        order = { id: session.id, email, plan, stripe_customer_id: customerId,
          report_id: session.metadata.reportId, check_id: session.metadata.checkId || null,
          context: session.custom_fields.find((field) => field.key === "context")?.text?.value ?? session.metadata.context };
      } else throw new Error("Checkout price mismatch");
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      entitlement = await subscriptionState((event.data.object as Stripe.Subscription).id);
      break;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const id = objectId(invoice.parent?.subscription_details?.subscription ?? null);
      if (id) entitlement = await subscriptionState(id);
      break;
    }
    case "checkout.session.async_payment_failed":
      // An unpaid delayed-method checkout never receives an entitlement.
      break;
    default: return;
  }
  await rpc("apply_billing_event", { p_event_id: event.id, p_created: event.created,
    p_entitlement: entitlement, p_order: order });
}
