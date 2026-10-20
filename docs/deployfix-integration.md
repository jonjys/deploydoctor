# DeployFix integration

## Sources and scope

DeployDoctor base: `d4c7c63edc623633ea2d13f973705f168ab6c45d` (`master`). The requested `nyttintent/nytto-deployfix` GitHub URL returned 404 through both the connector and an authenticated browser. The owner-authorized fallback used the original **Nytto DeployFix** Sites source, project `appgprj_6aca3b7b48d48191818ad162480699ed`, commit `239afb0967fef42d4512aba97d336b1e5deccc2a`. This does not establish that the unavailable GitHub repository has the same contents.

Adapted from DeployFix: unique-target resolution, full-context diffs, record-bound AES-GCM, recovery by high-entropy private key, strict expanded Stripe payment checks, bounded request/response reads and relevant parser/payment/recovery tests. DeployDoctor already had a TypeScript parser and multi-file patch planner; these remain the canonical implementation. No Cloudflare/D1 deployment, extra payment product, AI dependency or duplicate scanner was introduced. DeployFix and the Gumroad Rescue Kit are unchanged. No customer data was migrated.

## Analysis to patch

Scans resolve a branch/ref once and fetch an archive by immutable 40-character commit SHA. Public analysis cache keys include that SHA; private-token scans continue to bypass the cache. Reports/API responses show the scanned commit. Patch preparation uses exactly that report commit and its blob IDs, rather than moving to the latest default branch. Old reports without a pinned commit require a fresh scan.

Case-fold collisions, multiple candidate extensions and missing files require review. Comments and string examples are ignored by the AST. Symlink targets are excluded from patch preparation. Unsupported, credential-bearing, CRLF and oversized source cannot be patched automatically. File/line/before/after/commit are shown before purchase; no promise of a successful build is made.

Diffs carry full Git blob IDs and full-file context. The server's pure verifier reconstructs the original and replacement and verifies their hashes. Real Git tests verify `git apply --check --index` on the original and rejection of changed import lines, distant code and appended code. **Use `--index`: plain `git apply --check` alone can accept an appended line even with full-file context.** Apply on a clean working tree at the displayed commit; review and run the project's own tests before pushing. The service never executes repository code.

## Payment and delivery

The existing $5 USD one-time patch product, Stripe SDK, Checkout route, webhook endpoint, signing secret and encrypted Stripe metadata are retained. New AES-GCM tokens bind the encrypted quote to its report ID; legacy encrypted purchases remain readable. Prepared offers bind Checkout to the browser's HttpOnly access key. No new secret or database migration is required.

The private key is shown before payment and again with the payment reference on the paid page. `/patch/restore` requires both. It submits the key in a same-origin POST, never in a URL, and only restores the cookie after current Stripe payment verification. A lost key is not recoverable from an email address alone; older purchases still need an existing valid access cookie to display their key.

Downloads require a signed 15-minute link **and** the matching owner cookie. Reloading the paid page refreshes the link. Every retrieval checks the current Checkout session, exact product/quote/report/amount/currency, live/test environment, succeeded PaymentIntent with exact amount received and a successful charge without any partial refund, full refund or dispute. The encrypted patch remains in the existing Stripe storage. Links expiring does not force another purchase.

Patch webhook handling is stateless and repeatable. Both completed and asynchronous-success events read current Stripe state. Pending or revoked payments get no grant; API failures cause a retry. Refund/dispute events do not create entitlements, and a delayed success event cannot bypass the fresh checks on download. Existing scan-pass fulfillment remains in place. Patch routes/pages disable caching and referrer transmission. No test charges or refunds are made during local tests.

## Capacity

Existing archive limits remain: 20 MB compressed, 100 MB expanded, 30,000 entries, 180 retained text files, 24 MB retained text and three concurrent downloads. Shared GitHub budgets remain 4,000 requests/hour and 200/minute. GitHub JSON is bounded to 6 MB. Patch preparation allows three concurrent preparations, at most 12 flagged source files plus four root configs, 256 KB/source, 24 KB/diff and the existing encrypted-metadata ceiling. Large patches are refused, not truncated into a misleading offer.

Database-backed per-minute patch limits (identity/site): prepare 6/60, checkout 6/60, restore 5/30, delivery 30/120. They use existing HMAC-keyed budgets and expiring concurrency leases. These are capacity controls, not a DDoS guarantee.

## Anthropic

Only `POST /api/diagnose` calls `diagnoseWithClaude` in `src/lib/ai-diagnose.ts`, through `@anthropic-ai/sdk` and the server-only `ANTHROPIC_API_KEY`. It uses `claude-opus-5-5` for pasted build-log explanations and suggested steps/patch text, after masking recognized secrets. Existing limits cap output at 2,000 tokens, free usage at one/day, paid usage at ten/account/UTC day and the site at forty/day. Repository analysis and verified import patches make **no AI calls**. A production diagnosis returned HTTP 200 in the preceding release verification on 2026-10-19; this integration does not change that path.

## Validation and rollback

Run `npm test`, `npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, and `npm audit --omit=dev --audit-level=high`. The added integration suite covers real git application, parser edge cases, source drift, immutable fetches, recovery/ownership, link expiry, exact payments, refunds/disputes, repeated/out-of-order webhooks, legacy artifact compatibility, signed raw webhook bodies and chunked body limits. Stripe is mocked for the purchase lifecycle; no real card or payment is used.

Release through a reviewed GitHub PR after validation, then check the production commit, pinned public report, restoration page and anonymous/expired download denial. Real paid Checkout delivery still needs an explicitly authorized test payment in the configured Stripe environment. Roll back the application commit if necessary; the new release introduces no schema changes and preserves legacy quote decoding.
