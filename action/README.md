# DeployDoctor GitHub Action

Scans a pull request for the mistakes that break a Vercel deploy, before Vercel builds it. Static analysis through the GitHub API; nothing is cloned, installed or executed.

```yaml
name: DeployDoctor
on:
  pull_request:
jobs:
  deploydoctor:
    runs-on: ubuntu-latest
    steps:
      - uses: jonjys/deploydoctor/action@master
        with:
          token: ${{ secrets.DEPLOYDOCTOR_TOKEN }}
```

For a private repository, add `github-token: ${{ github.token }}` so the scan can read it.

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | required | API token from My scans on deploydoctor.nyttolabs.com. Needs an active pass. |
| `repository` | the workflow's repository | `owner/name` to scan. |
| `ref` | the pull request head, or the pushed commit | Branch, tag or commit to scan. |
| `github-token` | empty | Read token for private repositories, usually `${{ github.token }}`. Forwarded for this scan, never stored. |
| `fail-on` | `red` | `red`, `yellow` or `never`. |
| `checks` | stack-detected | Comma-separated: `next`, `vercel`, `env`, `supabase`, `prisma`. |

Outputs: `overall` (red, yellow, green), `report-url`, `red`, `yellow`. Findings are annotated on the changed files and listed in the job summary with a link to the full report.

Full documentation: https://deploydoctor.nyttolabs.com/ci
