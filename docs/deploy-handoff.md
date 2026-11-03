# Deploy Handoff

A manual operational handoff derived from the existing PR comparison. Reuses the same pinned merge-base/head snapshots, quotas, storage, authentication, report UI/JSON and repair infrastructure. No code execution, new AI calls, database migration, payment product or new public endpoint.

## Contract

New optional `ReportResults.deploymentInventory` (version 1) stores names, paths, line positions and SHA-256 change fingerprints. No environment values, raw script text or configuration contents are stored in this inventory. Build + environment categories must both be selected. Public scan caches change version so old results cannot hide the inventory.

`PullRequestImpact.handoff` and additive `reportJson().deployHandoff` provide:

- Version, merge-base SHA, head SHA, complete flag.
- Tasks: stable ID, kind, added/changed/removed, observed-change/needs-review confidence, file/line, base/head evidence side, title, action and verification step.
- Explicit limitations and always-manual production checks.

Existing reports remain valid and return `deployHandoff: null`. Existing check severities/results are not changed by a checklist. Private reports retain the same server authentication; no new download route. Copying the checklist is a user action and includes names/paths, so sharing a private checklist requires care.

## Supported inventory

JavaScript/TypeScript AST runtime-style environment expressions: `process.env.NAME`, `process.env['NAME']`, `import.meta.env.NAME`, and literal destructuring. Comments, string examples, test/fixture/example/tooling paths, dynamic names and common injected environment names are excluded. References with defaults are intentionally included: a task asks whether the name is optional or required; it never asserts a missing production value.

Migration paths: Supabase/Prisma migration files and Drizzle SQL. The entire snapshot tree provides file presence; read file bytes provide a fingerprint. No SQL is executed or interpreted by the handoff. Root/supported hosting configuration is fingerprinted, not evaluated a second time. Package build/start/prebuild/postbuild/postinstall strings are fingerprinted without returning their text. Next App/Pages API source files provide endpoint-source changes, not a guarantee of a deployed URL. Arbitrary backend routing, dynamic declarations and other-language environment references are not inventoried.

Both snapshots must carry the inventory and exact commits from the existing comparison. Repository identities must match. GitHub rename metadata preserves known file moves. Environment names are compared across files, avoiding new tasks for line/location movement. Partial scans, parse failures and incomplete rename coverage mark unmatched items as review candidates. Unread bytes cannot establish a changed fingerprint. Text changes, including formatting, can require review without proving a semantic change.

## Budgets and safety

300 items per inventory, 40 displayed tasks, explicit limitations at the boundary. Existing source/archive sizes, file counts, concurrency and GitHub budgets apply. The inventory parses only already-read files. No additional GitHub or provider requests. No provider credentials or raw values in a task. Every release check remains unchecked/manual; absence of tasks does not establish safety.

## Verification

Positive/negative fixtures cover real AST accesses vs comments/strings, optional references, injected names, line movement, GitHub-proven renames, raw-value non-disclosure, migration/hosting/script fingerprints, source-route removal, partial scans, malformed source, legacy data, repository/SHA mismatch and budgets. Existing report JSON and check results are preserved. Public/private report route regression tests remain applicable because data is delivered through the existing route.
