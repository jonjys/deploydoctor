# deploydoctor

Scan a public GitHub repository for the mistakes that break a Vercel deploy, from the terminal and before you push. One command, no install, no account.

```sh
npx deploydoctor vercel/commerce
```

Inside a checkout the argument is optional: the CLI reads the GitHub origin of the current folder.

```sh
npx deploydoctor
```

## What it prints

One row per check with the first file and line, then the summary and a link to the saved report, which anyone with the link can read.

```
DeployDoctor: vercel/commerce @ main 1a2b3c4d

Status  Check                               Where
Fail    Broken imports                      src/app/page.tsx:12
Review  Environment variables               src/lib/db.ts:3
Pass    Vercel-incompatible server code
Pass    Dependencies

Fail: 1 failed, 1 to review, 7 passed.
Report: https://deploydoctor.nyttolabs.com/r/<id>
```

Exit codes: 0 when no check is red, 1 when a check is red (so it works as a pre-push gate), 2 when the scan did not run because of a usage, network or API error, the daily limit included. Colors are used only on a terminal.

## Options

| Option | What it does |
| --- | --- |
| `owner/repo` or a github.com URL | The repository to scan. Without it, the git origin of the current folder. |
| `--checks next,vercel,env,supabase,prisma` | Run only these categories. The detected stack decides when left out. |
| `--json` | Print the report as JSON, the same shape as `GET /api/reports/<id>`, also for errors. |
| `--api <url>` | Another DeployDoctor instance, for self-hosting or tests. |
| `DEPLOYDOCTOR_TOKEN` | An API token from My scans. With one, scans are never subject to the free daily limit. |

## Free allowance

1 scan a day per IP, no account: the same allowance as the website form, and saved reports stay free to read. A pass removes the limit ($2 for 24 hours or $5 for 7 days, nothing renews): buy it at https://deploydoctor.nyttolabs.com/pricing, open My scans in the browser you paid in, click Create API token and run the CLI with `DEPLOYDOCTOR_TOKEN` set.

```sh
DEPLOYDOCTOR_TOKEN=ddt_... npx deploydoctor
```

## What it does and does not do

The CLI sends only the repository URL and your chosen checks to DeployDoctor. The server reads the repository through the GitHub API: nothing is cloned, installed, built or executed, on your machine or on the server. The nine checks are static: case-sensitive imports that only resolve on macOS, packages that are used but not declared, `process.env` reads without a fallback that no `.env.example` documents, Node-only modules on the Edge runtime, Prisma without `prisma generate`, live secrets in source, and more. A green result means those checks passed, not that the deploy will succeed; it does not run your build or your tests.

The CLI scans public repositories. For a private repository use the website with a pass, or the [GitHub Action](https://deploydoctor.nyttolabs.com/ci) with `github-token`.

## Requirements

Node 20 or newer. The package has no dependencies.

## Publishing (owner only)

The package is not published yet. Until it is, the root README and the /ci page do not show the npx command: an unregistered name could be taken by someone else and run on every visitor who follows the instruction. Meanwhile the CLI runs from a checkout with `node cli/bin.mjs owner/repo`. From the repository root:

```sh
cd cli
npm login
npm pack --dry-run
npm publish --access public
```

`npm pack --dry-run` lists what goes up: bin.mjs, package.json, README.md and LICENSE. After the first publish, delete the notice at the top of this section and put the `npx deploydoctor` one-liner back in the root README and on `src/app/ci/page.tsx`; `tests/cli.test.ts` checks that the public docs and this notice agree. For a later release, bump the version in `cli/package.json` (`npm version patch` inside `cli/`), commit, then run `npm publish --access public` again; the user-agent sent to the API follows the version automatically.

## License

Business Source License 1.1, like DeployDoctor itself. See LICENSE.
