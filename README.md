# DeployDoctor

## AI plugin

Connect a custom remote MCP server at `https://deploydoctor.nyttolabs.com/api/mcp`.
Public repository scans, saved reports and website pricing are available to AI
clients. No private tokens, code execution or automatic payment. The existing
three-free-scans/day source-IP allowance applies; website paid sessions do not
transfer to MCP. See [plugin documentation](plugins/deploydoctor/README.md) and
the public `/ai-plugin` setup page.

License: BSL 1.1 · Live: [deploydoctor.nyttolabs.com](https://deploydoctor.nyttolabs.com)

DeployDoctor scans a public GitHub repository for the mistakes that most often break a Vercel deploy and saves a shareable report. It reads the repository through the GitHub REST API. It does not clone, install, build, or execute the code it scans.

## What a scan does

1. Detects the stack from `package.json`, the lockfile, `vercel.json` and `.env.example`.
2. Runs only the checks that stack needs.
3. Saves the report in Supabase and shows it at `/r/[id]`, with a suggested fix for every failed check.

Statuses are Fail, Review and Pass. A check is red only when the finding is certain; anything that is a guess is yellow.

## Checks

| Check | What it finds |
|---|---|
| Next.js entrypoint | Next.js is declared but no `app/` or `pages/` route folder exists. |
| Broken imports | Relative, `@/` and tsconfig alias imports that point to files missing from the repository, including files that differ only by letter case (works on Mac and Windows, fails on Linux). |
| Vercel-incompatible server code | Playwright, Puppeteer, SQLite bindings, filesystem writes and other things that do not run in API routes or on the Edge runtime. |
| Build configuration | More than one lockfile, a missing `build` script, or an `engines.node` range that Vercel cannot run. |
| Dependencies | Imported packages that are not declared in `package.json`, and a lockfile that is out of step with `package.json`. |
| Environment variables | `process.env` reads that are not documented in `.env.example`, secret-looking values exposed through `NEXT_PUBLIC_`, and an `.env.example` that `.gitignore` keeps out of the repository. |
| Hardcoded secrets | Live Stripe, AWS, GitHub and Supabase keys and private keys in source. Reports show only the prefix and the last four characters. |
| Supabase server/client boundaries | Supabase browser clients used in server code, or a service role key used in client code. |
| Prisma / database | Prisma is used without `prisma generate` in the build, or the Prisma datasource uses SQLite, which does not persist on Vercel. |

Supabase and Prisma checks run only when the stack uses them.

## Local setup

Requirements: Node.js 22 or newer, npm, and a Supabase project.

```sh
npm install
cp .env.example .env.local
```

Every variable is listed and explained in `.env.example`. Free scans need only the Supabase values. `GITHUB_TOKEN` is optional but raises GitHub's rate limit and lets a scan read more files. The Stripe values and `SESSION_SECRET` are needed only for paid passes.

Apply the migrations in [`supabase/migrations`](supabase/migrations) to your Supabase project, then run:

```sh
npm run dev
```

Open `http://localhost:3000` and paste a public GitHub repository URL.

## Verification

```sh
npm test
npm run lint
npm run build
```

The tests in [`tests/`](tests) cover the analyzer, the dependency, gitignore, Node range and secret helpers, and run against fixtures only; no network is needed.

## Deploying to Vercel

Add the variables from `.env.example` to the Vercel project (Production and Preview), then deploy from the Vercel dashboard or with the Vercel CLI. Every push to `master` deploys production.

## License

DeployDoctor is source-available under the [Business Source License 1.1](LICENSE). You may read, fork, run it locally for private use and contribute. You may not offer it as a commercial hosted service that competes with [deploydoctor.nyttolabs.com](https://deploydoctor.nyttolabs.com). On 2029-09-27 the license changes to MIT.
