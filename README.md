# DeployDoctor

## Vercel Deployment Rescue Kit

Works locally but fails on Vercel? The [Vercel Deployment Rescue Kit](https://fieldworkstudio.gumroad.com/l/vercel-deployment-rescue-kit) is a **$19 one-time download**: a 14-page Next.js/Vercel debugging playbook, a 42-point editable release checklist and 5 reusable AI diagnosis prompts (PDF + CSV + Markdown in one ZIP).

Start with [three free debugging checks](https://fieldworkstudio.gumroad.com/p/works-locally-fails-on-vercel-start-with-these-3-checks), or use the [free preflight scanner](https://deploydoctor.nyttolabs.com). The kit is independent educational material by NyttoLabs, not a hosted scan pass or a done-for-you debugging service.

## AI plugin

Connect a custom remote MCP server at `https://deploydoctor.nyttolabs.com/api/mcp`.
Public repository scans, saved reports and website pricing are available to AI
clients. No private tokens, code execution or automatic payment. The free
allowance of one scan/day per source IP applies; website paid sessions do not
transfer to MCP. See [plugin documentation](plugins/deploydoctor/README.md) and
the public `/ai-plugin` setup page.

License: BSL 1.1 · Live: [deploydoctor.nyttolabs.com](https://deploydoctor.nyttolabs.com)

DeployDoctor scans a public GitHub repository for the mistakes that most often break a Vercel deploy and saves a shareable report. It reads the repository through the GitHub REST API. It does not clone, install, build, or execute the code it scans.

## CI: GitHub Action and API

The same checks run on a pull request before Vercel builds it. A public repository
gets one free scan a day to try it, with no account and no secret: the `id-token: write` permission
lets GitHub prove which repository is asking, and when the day's free scan is used the job
warns and passes instead of blocking the pull request. With a pass the Action scans every push.

```yaml
name: DeployDoctor
on: pull_request
jobs:
  deploydoctor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: jonjys/deploydoctor-action@v1
```

For a private repository, or more than 1 scan a day, a pass is needed. Create an API
token under My scans, store it as the `DEPLOYDOCTOR_TOKEN` secret and pass it:

```yaml
      - uses: jonjys/deploydoctor-action@v1
        with:
          token: ${{ secrets.DEPLOYDOCTOR_TOKEN }}
```

Findings are annotated on the changed files, the job summary links the report and the
job fails on a red check. The action is a thin client over `POST /api/reports` with
`Authorization: Bearer <token>`, which accepts an optional `ref` and answers with the
full report as JSON; `GET /api/reports/<id>` reads a saved one. See [action/](action/README.md)
and the public [/ci](https://deploydoctor.nyttolabs.com/ci) page.

### Terminal CLI

The same scan from the terminal, without a workflow, lives in [cli/](cli/README.md): one file,
no dependencies. It is not on npm yet, so run it from a checkout of this repository:

```sh
node cli/bin.mjs vercel/commerce
```

Inside a checkout of your own project the argument is optional; the CLI reads that folder's
GitHub origin. It prints one row per check with the first file and line, links the saved report
and exits 1 on a red check, so it works as a pre-push gate. Free scans count against the
website's allowance of 1 scan a day per IP; with a pass, set `DEPLOYDOCTOR_TOKEN` to an API
token for unlimited scans. Nothing is cloned or executed locally. The npx one-liner arrives with
the first npm release; see Publishing in [cli/README.md](cli/README.md).

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

## Latest repository status and verified fixes

Every public report offers a permanent repository badge and status page:

```md
[![DeployDoctor repo status](https://deploydoctor.nyttolabs.com/badge/OWNER/REPO.svg)](https://deploydoctor.nyttolabs.com/score/OWNER/REPO)
```

The status uses the latest saved public scan of the default branch. It shows its date and commit,
marks partial scans and results older than seven days, and never starts a scan on a page or badge view.
Private reports and PR-head scans are excluded. A passed check is not a deployment guarantee.

A purchased, verified import patch can also be opened as a **draft pull request** from its order page.
The buyer supplies a temporary fine-grained token scoped to the public repository, with Contents and
Pull requests write permissions. The token is used for that request, never stored or logged. This is
an explicit action, not an installed GitHub App or unattended repair service.

The server rechecks owner access and Stripe payment (including refunds and disputes), requires the
scanned commit to remain the default-branch head, verifies original source hashes, applies the exact
paid diff, and creates a new branch without overwriting another branch. Repeated requests reuse the
same PR. Review the diff and run your tests/build before merging. Environment documentation and other
suggested changes remain manual. Existing scan prices, free quotas and the Gumroad Rescue Kit stay as is.

Operational funnel logs record scan/diagnosis starts and completions and draft PR creation without
repository names, source, logs or credentials. Counts represent attempts, not unique people or payment attribution.

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


### Launch Readiness and production safety

The existing snapshot scanner now includes eight additional AST-based rule families: Stripe raw-body verification inputs, visible webhook event verification, Pages API body parsing, loopback checkout redirects, Next.js client/server boundaries, invalid route runtime literals, personalized force-static handlers and explicitly disabled HTTPS certificate verification. Uncertain risks require review; only direct Next.js configuration/boundary errors are red. No additional AI calls or GitHub file requests.

Saved reports include Launch Readiness: blockers, review findings, evidence, next steps and separate manual verification. Checkout, runtime, deployed environment values and traffic capacity are not tested. Existing pricing, private access, Watch opt-in and verified import repair flow apply.

- [Before/after detection inventory and primary references](docs/launch-readiness-audit.md)
- [MakeItReal server integration contract](docs/integrations/holiday-launch-readiness.md)
- [Launch entry point](https://deploydoctor.nyttolabs.com/launch-readiness)
