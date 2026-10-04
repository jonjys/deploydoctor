import assert from "node:assert/strict";
import test from "node:test";
import {
  checkoutContext,
  checkoutSessionParams,
  configuredScanPriceId,
  isProbeContext,
  isProbeHeader,
  orderContext,
  readStripeHealth,
} from "../src/lib/checkout-guard";
import { isStripeCheckoutUrl, scanCheckoutHref } from "../src/lib/scan-checkout";

test("probe contexts and the health header never look like a real note", () => {
  for (const context of ["health-check-2026-10-04", "watch-home", "health-probe-no-pay", "  Probe", "WATCH-1", "healthcare", "watchtower"]) {
    assert.equal(isProbeContext(context), true, context);
  }
  for (const context of ["", "https://github.com/health/repo", "owner/repo", "the health of the deploy"]) {
    assert.equal(isProbeContext(context), false, context);
  }
  assert.equal(isProbeContext(undefined), false);
  assert.equal(isProbeHeader(new Headers({ "x-health-probe": "1" })), true);
  assert.equal(isProbeHeader(new Headers({ "X-Health-Probe": " 1 " })), true);
  assert.equal(isProbeHeader(new Headers({ "x-health-probe": "0" })), false);
  assert.equal(isProbeHeader(new Headers()), false);
});

test("checkout context stored in metadata is capped and optional", () => {
  assert.equal(checkoutContext(undefined), "");
  assert.equal(checkoutContext(12), "");
  assert.equal(checkoutContext("a".repeat(400)).length, 300);
  assert.equal(orderContext({ metadata: { context: "https://github.com/acme/app" } }), "https://github.com/acme/app");
  assert.equal(
    orderContext({
      custom_fields: [{ key: "context", text: { value: "older stripe answer" } }],
      metadata: { context: "metadata value" },
    }),
    "older stripe answer",
  );
  assert.equal(orderContext({ custom_fields: [], metadata: { context: "from metadata" } }), "from metadata");
});

test("hosted checkout params keep context in metadata and do not ask Stripe for it", () => {
  const params = checkoutSessionParams({
    plan: "day",
    lang: "en",
    reportId: "",
    checkId: "",
    context: "https://github.com/acme/app",
    browser: "digest",
    origin: "https://deploydoctor.example",
    lineItem: { quantity: 1, price_data: { currency: "usd", unit_amount: 200, product_data: { name: "Day" } } },
    integrationIdentifier: "deploydoctor-abcdefgh",
  });
  assert.equal("custom_fields" in params, false);
  assert.equal(params.payment_method_types, undefined);
  assert.equal(params.metadata?.context, "https://github.com/acme/app");
  assert.equal(params.metadata?.app, "deploydoctor");
  assert.equal(params.metadata?.plan, "day");
  assert.equal(params.customer_creation, "always");
  assert.equal(params.success_url, "https://deploydoctor.example/checkout/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, "https://deploydoctor.example/checkout?plan=day");
  assert.equal(params.integration_identifier, "deploydoctor-abcdefgh");
  assert.equal(JSON.stringify(params).includes("sk_"), false);

  const subscription = checkoutSessionParams({
    plan: "public",
    lang: "sv",
    reportId: "",
    checkId: "",
    context: "",
    browser: "digest",
    origin: "https://deploydoctor.example",
    customerId: "cus_123",
    lineItem: { price: "price_example", quantity: 1 },
    integrationIdentifier: "deploydoctor-ijklmnop",
  });
  assert.equal(subscription.customer, "cus_123");
  assert.equal(subscription.customer_creation, undefined);
  assert.equal(subscription.subscription_data?.metadata?.plan, "public");
  assert.equal("custom_fields" in subscription, false);
});

test("stripe health check retrieves one price and returns no secrets", async () => {
  let retrieved: string | null = null;
  const secret = "sk_live_" + "abcdefghijklmnopqrstuv";
  const priceId = "price_" + "1234567890";
  const ok = await readStripeHealth({
    secretConfigured: true,
    priceId,
    retrieve: async (id) => {
      retrieved = id;
      return { id, active: true };
    },
  });
  assert.equal(retrieved, priceId);
  assert.deepEqual(ok, { body: { ok: true, stripe: "reachable" }, status: 200 });
  assert.deepEqual(Object.keys(ok.body).sort(), ["ok", "stripe"]);

  const failed = await readStripeHealth({
    secretConfigured: true,
    priceId,
    retrieve: async () => {
      throw new Error(`Invalid API key ${secret} for ${priceId}`);
    },
  });
  const encoded = JSON.stringify(failed.body);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes(priceId), false);
  assert.deepEqual(failed.body, { ok: false, stripe: "unreachable" });
  assert.equal(failed.status, 503);

  let called = false;
  const unconfigured = await readStripeHealth({
    secretConfigured: false,
    priceId,
    retrieve: async () => {
      called = true;
      return {};
    },
  });
  assert.equal(called, false);
  assert.deepEqual(unconfigured.body, { ok: false, stripe: "unconfigured" });
  assert.equal(configuredScanPriceId({ STRIPE_PRICE_5_ONETIME: "not-a-price", STRIPE_PRICE_9_PUBLIC: priceId }), priceId);
  assert.equal(configuredScanPriceId({}), null);
});

test("scan plan buttons fall back to the checkout page", () => {
  assert.equal(scanCheckoutHref("day"), "/checkout?plan=day");
  assert.equal(scanCheckoutHref("public"), "/checkout?plan=public");
  assert.equal(scanCheckoutHref("week", "report id", "check/1"), "/checkout?plan=week&report=report+id&check=check%2F1");
  assert.equal(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123"), true);
  assert.equal(isStripeCheckoutUrl("http://checkout.stripe.com/c/pay/cs_test_123"), false);
  assert.equal(isStripeCheckoutUrl("https://checkout.stripe.com.evil.com/c/pay/cs_test_123"), false);
  assert.equal(isStripeCheckoutUrl("https://js.stripe.com/v3"), false);
  assert.equal(isStripeCheckoutUrl("javascript:alert(1)"), false);
});
