# Multi-host scanning, November 2026

DeployDoctor keeps one scanner, one immutable repository snapshot, the existing quota/authentication model and the same reports, repairs, PR comparison, API, Action and CLI. Platform rules inspect committed data only. No repository code, config module, build, plugin or Railway TypeScript IaC is executed. No new AI usage, dependency or database migration is introduced.

## Before and after

| Area | Before | This release |
| --- | --- | --- |
| Cloudflare | TOML syntax and a platform name | Wrangler TOML/JSON/JSONC syntax; entrypoint and casing evidence; generated-output distinction; calendar-valid compatibility dates; date/flag-aware Node import risks through local modules; binding collisions per environment; mixed Pages/Workers settings; asset-directory/file conflicts; ambiguous config selection |
| Netlify | Root npm script and functions-inside-publish checks | Adds base-directory evidence, nested package manifests, literal npm/pnpm/yarn/bun commands and per-context scripts, forced SPA fallback ordering, self-redirect review and edge-path syntax |
| Railway | No explicit configuration target | Recognizes legacy JSON/TOML and TypeScript IaC; validates legacy syntax and reviews missing Dockerfile paths. IaC, service root and current service eligibility remain unverified |
| Docker | File recognition | Adds review of explicit COPY/ADD environment-file operations that may put secrets in image layers |
| Existing source rules | Many Vercel-specific assumptions | Explicit alternative-host configurations no longer get Vercel-only Node version, Svelte/Astro adapter, SPA rewrite, browser/SQLite package or local SQLite hosting conclusions. Shared source risks and provider-specific findings remain |
| Reporting | Provider name alone | Additive hosting metadata: platforms, configuration files read, evaluated rule families, evidence-backed findings and limitations. /platforms explains exact language/host coverage |

## Added rule families

| Rule | Evidence | Classification |
| --- | --- | --- |
| hosting-config-syntax | Parsed root configuration cannot be read as the provider format | Source/config issue; ambiguous Wrangler selection stays review |
| cloudflare-config-selection | More than one root Wrangler config | Review |
| cloudflare-entrypoint | Exact main path absent from complete tree | Source/config issue only for a non-generated root entry; partial/custom-build/generated/environment cases stay review |
| cloudflare-compatibility-date | Explicit date fails calendar/format validation, or date is absent | Invalid root date: source issue; missing/optional environment: review |
| cloudflare-node-compatibility | Runtime AST import of a Node builtin reachable from Worker main, without recorded compatibility | Review. Dates from 2026-08-04 enable Node compatibility by default, unless both negative flags disable it |
| cloudflare-binding-collision | Duplicate name in binding collections within the same environment | Review; environment bindings are not incorrectly inherited |
| cloudflare-pages-worker-config | Pages output key mixed with Worker main/assets | Review |
| cloudflare-assets-directory | Assets directory points at a known committed file | Source/config issue; optional environment: review |
| netlify-base-directory | Literal base missing from complete tree | Source/config issue; optional context: review |
| netlify-context-build-script | Literal package-manager command names a missing script in the actual base package | Root: source issue; context-specific: review |
| netlify-forced-spa-shadow | Unconditional forced /* → /index.html precedes a function rewrite | Review; external _redirects/edge/plugin behavior remains unknown |
| netlify-redirect-loop | Literal self-redirect with a 3xx status and no conditions/query | Review because earlier rules and shadowing may affect it |
| netlify-edge-path | Literal edge path does not begin with / | Source/config issue; regex pattern declarations are not mistaken for paths |
| railway-dockerfile-path | Explicit legacy path not found | Review because service root and overrides are unavailable |
| docker-env-copy | Literal COPY/ADD of .env or a non-template variant | Review, not a claim that a secret exists or an image was built |

The two previous Netlify rules and Rust/Cargo checks are reused, not duplicated. The GitHub archive selector now reads Wrangler JSON, Railway files, policy files and nested package.json within the existing limits. The public scan cache version changes so older cached analysis cannot hide new capabilities.

## Accuracy and capacity

Generated directories are never asserted to be broken merely because their build output is uncommitted. Partial trees cannot establish missing Netlify bases; missing Worker source in partial scans is review. Type-only imports, comments and string samples are excluded by the shared TypeScript syntax-tree importer. A newer Cloudflare date without nodejs_compat is valid and creates no missing-flag warning.

Only literal commands/paths are checked; complex shell commands, workspace orchestration, provider plugins, dashboard settings and dynamic configuration require manual verification. Root hosting configs are analyzed; nested hosting configs are identified with an explicit limitation. At most 32 Cloudflare environments/Netlify contexts and 100 platform findings are retained. Worker source parses/import inventories are cached per snapshot and traversal is bounded by the existing 400-file limit. Archive, size, GitHub request budgets and concurrency gates remain in force.

The legacy category identifier `vercel` remains the compatible API name for Build & deployment. If it is not selected, platform rule findings/coverage are not produced. Report JSON and Launch Readiness carry exact coverage and limitations. Existing client field names, paid permissions and fail-on behavior remain unchanged. No new platform auto-patch is advertised.

## Source documentation checked

- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Node compatibility date/flag behavior](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
- [Netlify file configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
- [Netlify redirect ordering and force behavior](https://docs.netlify.com/manage/routing/redirects/redirect-options/)
- [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/)
- [Netlify edge declarations](https://docs.netlify.com/build/edge-functions/declarations/)
- [Railway legacy configuration reference](https://docs.railway.com/config-as-code/reference)

Railway's current documentation marks Config as Code deprecated for new services and describes a migration cutoff. This scanner does not certify that a service remains eligible for legacy config; inspect current provider instructions. Cloudflare runtime defaults were checked against current official docs, rather than assuming the older missing-nodejs_compat behavior.

## Tests

`hosting-config.test.ts` includes positive and negative fixtures for every new family, AST strings/comments, modern and legacy dates, generated/partial entrypoints, nested manifests, conditional redirects, explicit edge regexes, unchanged alternative-host adapter/SQLite choices and selected-category behavior. `hosting-github.test.ts` exercises the real archive downloader/analyzer pipeline with fake bounded HTTP responses: nested package.json and wrangler.json are read at a fixed SHA, concurrency guards are used, credentials are not forwarded to codeload, and source containing an execution trap remains data.
