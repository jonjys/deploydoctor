# Repository coverage beyond Next.js

## Before and after

Previously, root projects without package.json were offered the Next.js category, and generic import checking was tied to that category. That made Rust projects look unsupported and omitted useful import checks for other JavaScript stacks.

Now the same snapshot scanner discovers Cargo, Go, Python, Netlify, Docker and Cloudflare configuration and reads common source extensions for secret detection. It does not execute repository code. Source-count and byte/file/time limits still apply and partial reports remain partial. Existing report IDs/categories remain compatible; the legacy `vercel` category is labeled Build & deployment in the UI.

| Project or host | Static evidence checked |
| --- | --- |
| JavaScript / TypeScript | Existing AST import resolution across Node stacks, existing dependency, environment and production checks where applicable |
| Rust | Cargo TOML syntax; edition vs declared minimum Rust version; pinned toolchain vs minimum; missing explicitly declared lib/bin target paths on complete snapshots; locked pipeline without Cargo.lock as review |
| Netlify | TOML syntax; explicit npm build command with missing script in the resolved package; functions source inside publish as review |
| Go / Python | Manifest discovery, supported secret signatures, literal standard-library environment references as review; Python TOML syntax |
| Other common source languages | Source inventory and supported secret signatures; limited configuration coverage is explicitly shown |
| Docker / Cloudflare | Configuration discovery and available static checks; this release does not execute containers or verify platform settings |

A configuration-only result never asserts compilation or live deployment success. Rust compiler diagnostics, dependency resolution, macros, build.rs, arbitrary build scripts, live hosting settings and traffic behavior remain unverified. Go/Python checks do not parse the full languages or validate dependencies. Environment documentation warnings do not establish missing production values.

## False positives and boundaries

Only parsed TOML values drive Cargo/Netlify checks. Dynamic commands, workspace npm scripts, unpinned Rust channels and implicit Cargo targets are not treated as provably wrong. Missing target files are not asserted from partial snapshots. A missing lockfile under a locked command remains review because a pipeline may generate it earlier. Existing source-backed findings are preserved when portable build findings are merged. No portable auto-fix is sold or generated.

Regression fixtures cover Rust version conflicts, target casing, valid stable toolchains, partial target coverage, missing/present lockfiles, malformed TOML, Netlify command errors and function directory placement, plus Go/Python environment references. The general import fixtures cover Vite, Astro, SvelteKit, Express and Nuxt.
