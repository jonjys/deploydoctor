# Launch reliability update

Apply `supabase/migrations/20261019174835_launch_guardrails.sql` to the DeployDoctor database BEFORE merging this branch. The change is additive: three server-only tables and two functions. It does not change billing or existing report rows.

## Release checks

- Run npm ci, npm test, npm run lint, next typegen, tsc --noEmit, next build and npm audit --omit=dev.
- Confirm anonymous/authenticated roles cannot read the budget/cache tables or execute the budget functions.
- Smoke-test a public repo scan, a repeated public scan (cache), a private-token scan and a build log diagnosis.
- Repeat stack detection 11 times from one test identity: the 11th must return 429 and Retry-After without a purchase prompt.
- A second confirmation request to the same test mailbox within 15 minutes must return 429 before rotating its confirmation token or sending another email.

## Enforced budgets

AI: 1 free attempt/day, up to 10 paid attempts/account/UTC day, 40 attempts/site/UTC day, 2 attempts/identity/minute, 1 concurrent diagnosis per identity and 3 site-wide. Each provider call has at most 2,000 output tokens, no automatic retries or model fallback. Provider failures consume the spend budget even when the free allowance is refunded.

Detection: 10 attempts/IP/minute and 50/site/minute. Shared GitHub token: 4,000 calls/hour and 200/minute; unrelated token use can consume additional GitHub capacity. Downloads: 3 concurrent, 20 MB compressed, 100 MB expanded, 30,000 entries, 180 retained text files and 24 MB retained text. Public complete scan results are cached for 120 seconds, keyed by repository, push timestamp, ref, categories and language. Private-token requests bypass this cache. Neither source code nor credentials are cached.

Confirmation email: 15-minute recipient cooldown, at most 3 attempts/recipient/day and 100/site/day, plus the existing IP/watch limits. Attempts are counted before sending; failures cannot be looped for free.

## Limits

These controls bound this app's admitted work; they are not a DDoS guarantee or a provider dollar-denominated account budget. Large archives are rejected rather than falling back to hundreds of API calls. Private archive access and paid AI delivery still require an authenticated deployment smoke test. The development dependency braces has an upstream advisory with no patched version available at implementation time; production dependency audit is clean.

## Rollback

Revert the application commit if smoke tests fail. The unused additive database objects can remain; do not drop tables containing active budget state during a rolling application deployment.
