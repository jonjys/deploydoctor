# DeployDoctor GitHub Action

Scans a pull request for the mistakes that break a Vercel deploy, before Vercel builds it. Static analysis through the GitHub API; nothing is cloned, installed or executed.

**Free on public repositories**: no account, no token, 3 scans a day per repository.

```yaml
name: DeployDoctor
on:
  pull_request:
jobs:
  deploydoctor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # GitHub proves which public repository is asking
    steps:
      - uses: jonjys/deploydoctor/action@master
```

When the free scans for the day are used, the job prints a warning and passes; it never blocks a pull request for that.

Private repository or unlimited scans: create an API token under My scans while a pass is active and pass it as `token`. For a private repository, also add `github-token: ${{ github.token }}` so the scan can read it.

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | empty | API token from My scans on deploydoctor.nyttolabs.com, while a pass is active. Leave it out on a public repository to scan for free. |
| `repository` | the workflow's repository | `owner/name` to scan. |
| `ref` | the pull request head, or the pushed commit | Branch, tag or commit to scan. |
| `github-token` | empty | Read token for private repositories, usually `${{ github.token }}`. Forwarded for this scan, never stored. |
| `fail-on` | `red` | `red`, `yellow` or `never`. |
| `checks` | stack-detected | Comma-separated: `next`, `vercel`, `env`, `supabase`, `prisma`. |

Outputs: `overall` (red, yellow, green), `report-url`, `red`, `yellow`. Findings are annotated on the changed files and listed in the job summary with a link to the full report.

Full documentation: https://deploydoctor.nyttolabs.com/ci
