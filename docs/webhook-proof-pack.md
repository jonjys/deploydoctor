# Pasted webhook review and regression-test scaffold

Extends the existing `/webhook-replay-lab` and `checkProductionSafety` AST scanner. No second rule engine, model call, GitHub token or Stripe request. The original interactive example is retained under a disclosure. Home and social metadata link to the same route.

## What users can do

Paste one Next App Router, Next Pages API or Express JavaScript/TypeScript handler, optionally add relevant SQL migrations or a Prisma schema, and inspect existing payment findings by file/line with an excerpt and recommended next step. The file path is a synthetic analysis context selected by handler type; it is not a claim about a scanned repository or commit. Imported helpers and middleware are absent, so findings require review. Syntax errors and no matching pattern never produce a safety pass.

Download five dependency-free Node regression tests and adapter instructions. Cases are sequential retries, concurrent retries, process restart, two event IDs for one paid Checkout Session, and a failure after the event claim but before fulfillment. The tests are a scaffold: the developer must connect a local adapter to the actual application and isolated test database. Missing adapter fails. Tests assert committed business actions, not HTTP statuses or just ledger rows. They do not test signed network delivery, ordering, delayed payment methods, full Stripe payload shape or all crash boundaries. No automatic webhook patch is claimed.

## Permissions, budgets and privacy

`POST /api/webhook-review` is same-origin only. It reuses `requestCustomer`, `activePlan`, `reserveScan`/`finishScan`, `scanAllowance(null)` and the atomic work-budget service. A free pasted review and a free repository scan share the same daily IP allowance. Existing active passes are revalidated server-side. Attempts are also bounded to three/minute per IP, forty/minute site-wide, and two concurrent reviews. No pricing, Stripe products or entitlement schema changes.

Request bytes are streamed with a 90KB limit; handler text is at most 40,000 characters, schema 30,000. Only predefined handler and schema types are accepted; arbitrary fetch URLs/filenames are not accepted. Recognized credential patterns are refused in browser and server before analysis. Users must remove other secrets and personal data too; regex detection is not comprehensive. Submitted source is processed server-side in memory and is not deliberately persisted, logged, put in a saved/public report, shared link, download or checkout parameter. Browser inputs are not persisted in localStorage/sessionStorage. Reloading clears them. The API returns no-store responses. Quota records contain existing reservation metadata, not source.

Only local data structures are parsed. No source imports, handler code, migrations or build scripts execute. The downloaded scaffold has no network client or embedded customer code; application execution happens only if a developer later writes and runs their own adapter locally.

## Verification

New tests exercise AST evidence, comment/string lookalikes, malformed source, provided unique constraints, nonexecution, credential refusal, payload validation, same-origin rejection, invalid API credentials, shared free quota, active-pass handling, rate limits and lease release. The generated test file is executed against a known-correct fixture (5 pass), a deliberately non-idempotent fixture (4 fail), and missing setup (fails). These fixtures validate the scaffold, not an actual merchant checkout.

Primary references: https://docs.stripe.com/webhooks#handle-duplicate-events and https://docs.stripe.com/webhooks#event-ordering. No real customer purchase, external post or live webhook was made by this release.

Release checks: 409/409 tests pass, ESLint passes, TypeScript passes within the clean production build, and production npm audit reports zero vulnerabilities. The local Turbopack persistence cache was invalid after workspace restoration; a clean generated cache resolved it. No dependency, database migration or billing change is included.
