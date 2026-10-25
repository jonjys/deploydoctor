# Launch Readiness implementation audit

Baseline: master 185cb82, 2026-10-25. This extends the existing snapshot analyzer; no second scanner, AI calls, billing changes or database migration.

## Reuse inventory

- analyzer.ts: nine check groups, category selection, partial coverage, source exclusion. Already covers Edge/Node imports, filesystem writes, static export, cron/Hobby settings, package managers, Node engines, native Linux binaries, env templates, secrets, Supabase RLS/grants and Prisma generation. Do not duplicate these.
- report-json.ts and /api/reports: saved report serialization; bearer-token paid access, public OIDC quota, owner-only private reports; /api/scan is the existing browser route.
- report-insights.ts and fix-instructions.ts: priorities, coverage placeholders and existing detailed fixes.
- /api/patch/pull-request: paid, commit-pinned verified import patches, explicit authorization and draft PRs. New rules produce manual recommendations, not speculative automatic repairs.
- Existing badges, Watch, CLI and MCP consume the same saved reports.
- Growth HQ authenticates before loading existing Vercel Analytics/Stripe adapters; no new analytics storage.

## Before → after detection inventory

Eight additional rule families in one production-safety group, enabled with the existing Vercel category:

| New rule | Evidence | Classification / false-positive boundary |
|---|---|---|
| stripe-raw-body | Direct Stripe constructEvent argument comes from request.json() / JSON.parse / JSON.stringify | Review: transformed payload is visible; opaque helpers and custom verification are not judged |
| stripe-event-verification | Stripe-importing webhook route directly parses request JSON and reads event.type without a visible verifier | Review only: authorization may exist in imported middleware |
| stripe-pages-body-parser | Pages API webhook calls Stripe verifier without explicit bodyParser:false | Review only: request parsing might be customized elsewhere |
| checkout-local-redirect | Literal localhost/loopback success_url or cancel_url in checkout.sessions.create | Review: may be intentional development-only code; dynamic URLs not guessed |
| next-client-boundary | use-client module imports server-only/next/headers or exports metadata/generateMetadata | Error for direct, executable imports/exports; type-only imports excluded |
| next-runtime-value | Literal route runtime outside nodejs/edge (experimental-edge reviewed) | Error only for known invalid literal; expression values left for manual checking |
| personalized-static-cache | GET route force-static plus direct request header/cookie access | Review: statically forcing personalized data is risky, no data leak asserted |
| tls-verification-disabled | Node HTTPS Agent explicitly sets rejectUnauthorized:false | Review: TLS verification disabled; no global vulnerability claim |

AST-based detection ignores comments, prose strings, declaration/test fixtures and unread files. No absence-of-helper inference becomes a confirmed vulnerability. Reports never include secret values. Limits and unchanged pricing apply.

## Primary references

- https://docs.stripe.com/webhooks (raw bytes and duplicate delivery)
- https://nextjs.org/docs/app/api-reference/functions/generate-metadata (server-only metadata)
- https://nextjs.org/docs/app/api-reference/directives/use-client
- https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- https://nodejs.org/api/https.html#class-httpsagent

Runtime checkout, durable idempotency, transaction correctness, live traffic/load and deployed environment values cannot be proved from source. They remain explicit manual checks.

## Failure impact

- Parsed or reserialized webhook payloads can invalidate Stripe signatures and stop fulfillment.
- Unsigned webhook event processing can accept forged events if no upstream verifier exists; this check therefore requires human review.
- Pages API default body parsing can consume the bytes that Stripe verification needs.
- Loopback checkout redirects send customers back to their own computer instead of the deployed app.
- Server-only imports or page/layout metadata in a client component can prevent a Next.js build.
- Unsupported route runtime literals can reject deployment configuration.
- Forced static rendering with request-dependent data can discard session context or serve unsuitable cached output.
- Disabling HTTPS certificate verification removes protection against untrusted upstream certificates.

## Verification record

- 326 tests passed, including positive/safe-negative fixtures for every new rule, comments/prose, type-only imports, framework gating, arrow handlers, malformed syntax, mixed severity and additive JSON/MCP output.
- Lint, generated Next.js route types, TypeScript, production build and production dependency audit passed (zero vulnerabilities reported).
- Trusted local repository snapshot: 203 source files at the first run, no production-safety findings; the complete analysis took about 716 ms locally. A 400-small-route-file check of the new module took about 18 ms. These are local processing checks, not a service load test.
- Production-build HTTP smoke with a local database fixture: public JSON/report 200, private report anonymous 404, unrelated owner 404, owner bearer 200 with private no-store, invalid bearer 401, no paid API entitlement 402. Growth HQ remained a login screen to anonymous visitors. Landing page and sitemap returned 200.
- Existing payment, refund/dispute, draft-PR ownership, quota, CLI, MCP, Watch and badge tests remain in the full suite. No actual purchase or paid repair PR was created during this release.
- The separately published GitHub Action receives a minimal annotation update to preserve each finding's review/error classification; existing group-level fail-on behavior stays intact.
- MakeItReal is not connected by this release. The contract describes owner-authorized server integration; no cross-project entitlement or secret sharing is introduced.
