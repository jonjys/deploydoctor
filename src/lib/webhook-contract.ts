/** Deterministic, dependency-free test scaffold. It never contains pasted customer source or credentials. */
export function webhookContract() {
  return `// DeployDoctor webhook contract. Adapt to an ISOLATED local/test database only.
// No Stripe SDK, signing secrets, production requests or real payments are used by this file.
// This is NOT a test of raw-body signature verification or a complete Stripe event fixture.
// Implement the adapter below before running. Missing setup fails instead of passing/skipping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const adapterPath = process.env.DEPLOYDOCTOR_WEBHOOK_ADAPTER;
if (!adapterPath) throw new Error('Set DEPLOYDOCTOR_WEBHOOK_ADAPTER to your local adapter module. Read the downloaded setup instructions. No application was tested.');
const { createHarness } = await import(pathToFileURL(resolve(adapterPath)).href);
if (typeof createHarness !== 'function') throw new Error('Adapter must export createHarness.');
const fixture = (purchase, id) => ({ id, object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: { id: purchase, object: 'checkout.session', payment_status: 'paid', metadata: { deploydoctor_test: 'true' } } } });
async function scenario(run) {
  const purchase = 'cs_dd_' + randomUUID().replaceAll('-', '');
  const h = await createHarness({ purchaseId: purchase });
  try {
    for (const method of ['deliver', 'applications', 'restart', 'failNextBeforeFulfillment', 'dispose']) assert.equal(typeof h[method], 'function', 'Adapter needs ' + method);
    assert.equal(await h.applications(), 0, 'Every scenario needs fresh isolated state');
    await run(h, fixture(purchase, 'evt_dd_' + randomUUID()));
  } finally { if (typeof h?.dispose === 'function') await h.dispose(); }
}
test('same event delivered five times applies fulfillment once', { timeout: 15000 }, () => scenario(async (h, event) => {
  for (let i = 0; i < 5; i++) await h.deliver(structuredClone(event));
  assert.equal(await h.applications(), 1);
}));
test('concurrent duplicate deliveries apply fulfillment once', { timeout: 15000 }, () => scenario(async (h, event) => {
  await Promise.all(Array.from({ length: 5 }, () => h.deliver(structuredClone(event))));
  assert.equal(await h.applications(), 1);
}));
test('process restart preserves durable duplicate protection', { timeout: 15000 }, () => scenario(async (h, event) => {
  await h.deliver(structuredClone(event)); await h.restart(); await h.deliver(structuredClone(event));
  assert.equal(await h.applications(), 1);
}));
test('two event IDs for one purchase do not repeat this fulfillment operation', { timeout: 15000 }, () => scenario(async (h, event) => {
  await h.deliver(structuredClone(event)); await h.deliver({ ...structuredClone(event), id: 'evt_dd_' + randomUUID() });
  assert.equal(await h.applications(), 1);
}));
test('failure before fulfillment can retry without losing the business action', { timeout: 15000 }, () => scenario(async (h, event) => {
  await h.failNextBeforeFulfillment();
  await assert.rejects(() => h.deliver(structuredClone(event)), 'Injected failure must actually interrupt processing');
  assert.equal(await h.applications(), 0);
  await h.deliver(structuredClone(event)); assert.equal(await h.applications(), 1);
}));
`;
}
export function webhookContractInstructions() {
  return `DEPLOYDOCTOR WEBHOOK PROOF PACK

This is a regression-test scaffold, not a ready-made patch or proof of payment safety.
No customer source, secrets or real event payloads are included. Nothing is sent to Stripe.

1. Save deploydoctor-webhook.contract.test.mjs in your project.
2. Write a local adapter module that exports async createHarness({ purchaseId }).
3. Use an isolated disposable test database. Never connect this adapter to production.
4. Connect the harness to YOUR actual fulfillment path, not a copy of our simulation.
5. Run with Node 22+:
   DEPLOYDOCTOR_WEBHOOK_ADAPTER=./your-test-adapter.mjs node --test deploydoctor-webhook.contract.test.mjs

Adapter methods:
  deliver(event): await your actual fulfillment operation for this synthetic paid Checkout Session. Treat handled duplicates as a resolved delivery. No production email, shipping, Stripe calls or other irreversible side effects.
  applications(): return a numeric count of committed business actions for the purchaseId, read from the actual test database. Do not count just HTTP 200 responses or only dedupe ledger rows.
  restart(): recreate worker/process-local state, while preserving the test database. Do not clear the durable ledger.
  failNextBeforeFulfillment(): inject a single failure at the boundary AFTER your event claim and BEFORE the business action. The next deliver must reject. It must not be a fake failure before the claim: that would miss lost-work bugs.
  dispose(): safely remove only this scenario's test data/resources.

Each createHarness must start with zero business actions for its unique purchaseId. The five cases assert exactly one application after sequential duplicates, concurrent duplicates, a restart, two event IDs for the same purchase, and failure/retry. The business-key expectation is for one fulfillment operation per paid Checkout Session; adapt it for subscriptions, partial fulfillments and other operations.

Limitations:
This file requires adapter work and is expected to FAIL until configured. It does not test raw-body signatures, network retries, Stripe event-version details, event ordering, delayed payment methods, external outbox delivery or all failure boundaries. An adapter that does not exercise real application code cannot establish anything about your app. Passing tests covers these scenarios only.

Next step: scan your repository at https://deploydoctor.nyttolabs.com for cross-file context and existing verified repair options. No arbitrary automatic webhook patch is generated.
`;
}
