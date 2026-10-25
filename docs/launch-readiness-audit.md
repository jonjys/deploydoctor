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
| next-client-boundary | use-client module imports server-only/next/headers or exports metadata/generateMetadata | Error for direct runtime-used imports/exports; unused, type-position-only and shadowed imports excluded |
| next-runtime-value | Literal route runtime outside nodejs/edge (experimental-edge reviewed) | Error only for known invalid literal in a root Next route; expression values left for manual checking |
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

- 328 tests passed, including positive/safe-negative fixtures for every new rule, comments/prose, type-only imports, framework gating, arrow handlers, malformed syntax, mixed severity and additive JSON/MCP output.
- Lint, generated Next.js route types, TypeScript, production build and production dependency audit passed (zero vulnerabilities reported).
- Trusted local repository snapshot: 203 source files at the first run, no production-safety findings; the complete analysis took about 716 ms locally. A 400-small-route-file check of the new module took about 18 ms. These are local processing checks, not a service load test.
- Production-build HTTP smoke with a local database fixture: public JSON/report 200, private report anonymous 404, unrelated owner 404, owner bearer 200 with private no-store, invalid bearer 401, no paid API entitlement 402. Growth HQ remained a login screen to anonymous visitors. Landing page and sitemap returned 200.
- Existing payment, refund/dispute, draft-PR ownership, quota, CLI, MCP, Watch and badge tests remain in the full suite. No actual purchase or paid repair PR was created during this release.
- The separately published GitHub Action receives a minimal annotation update to preserve each finding's review/error classification; existing group-level fail-on behavior stays intact.
- MakeItReal is not connected by this release. The contract describes owner-authorized server integration; no cross-project entitlement or secret sharing is introduced.


### Production verification (2026-10-25)

- PR #69 merged as 191e60ddd766a923dc70886f41ff1cbb74f68944; Vercel dpl_Dkdg654FHQEupipz1sQyxbLM8odA READY on the canonical domain. Master validation and Supabase checks succeeded.
- Actual authorized public scan: https://deploydoctor.nyttolabs.com/r/9929ef92-cf12-4c1b-8641-1beee4c14e7d. Commit 191e60d; 204/204 source files read, complete, 0 red, 0 review, 9 applicable check groups passed. The production safety group recorded five applicable rule families; this is not a claim all eight payment/runtime cases were exercised on this repository.
- Canonical landing page, sitemap, pricing, CI page, stats and legacy report JSON returned 200; invalid API bearer returned 401. Anonymous Growth HQ returned its login screen without campaign analytics. No error/fatal runtime logs in the five-minute release window.
- Published Action PR #4 merged as d41146f53fd33eec20da5de36e4746963b47484e; its test/release workflow succeeded and v1 points to this commit.
- Physical iPhone rendering, real payment completion, real paid repair PR creation and MakeItReal connection were not verified. The preview report and production report were checked against their saved JSON.

- Additional compiler check: a minimal Next.js 16.4.2 production build with an unused next/headers import in a client page succeeded. The detector now requires a runtime reference (or an explicit server-only side-effect marker), skips type-position-only and shadowed imports, and has a regression fixture for each. It does not turn an eliminated import into a red finding.

- The corresponding client page that actually called cookies() failed the Next.js 16.4.2 build with the documented server/client boundary error. Both the passing and failing compiler examples were checked, rather than inferring failure from AST shape alone.

- Launch repair hints are absent on private reports; existing import repair availability still requires server-side eligibility/payment verification.
