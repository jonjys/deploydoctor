# PR Change Review

Paste a same-repository GitHub pull-request URL into the existing repository field. DeployDoctor reads two immutable snapshots through its current scanner: the PR merge base and the captured head commit. The saved report is the head scan, with an optional comparison inside `results.pullRequest`. No schema migration, new payment product, model call or source execution is involved.

## What changed

Before: scan a PR head and show all findings, or compare a report to an unrelated previous saved scan.

After: compare observations against the actual merge base. Show newly detected findings first, distinguish already-present findings, and list findings no longer detected. This is not a merge-result simulation or proof that a PR causes a deploy failure. The current target branch may have changed since the common base.

## Existing API, additive contract

`POST /api/reports` accepts either `{ "repoUrl": "https://github.com/owner/repo/pull/42" }` or `{ "repoUrl": "https://github.com/owner/repo", "pullRequest": 42 }`. CI may also provide `ref` as the full expected PR-head SHA. A mismatch returns 409 before downloading either snapshot. Branch-name ref overrides with a PR return 400. Fork PRs return 422; ordinary head-repository scanning remains available.

The browser receives its normal `{id, href}` response. CI/CLI receive existing full JSON fields plus `pullRequest` (null on ordinary/legacy reports):

```json
{
  "pullRequest": {
    "version": 1,
    "number": 42,
    "url": "https://github.com/owner/repo/pull/42",
    "baseRef": "main",
    "baseCommitSha": "<40-character merge-base SHA>",
    "headCommitSha": "<40-character head SHA>",
    "partial": false,
    "introduced": [],
    "persisting": [],
    "noLongerDetected": [],
    "uncertain": [],
    "notCompared": [],
    "limitations": ["Static findings only; not a build or merge simulation."]
  }
}
```

Finding entries retain the existing file, line, problem, fix, optional ruleId/repairable fields, plus checkId, title and status. Uncertain entries also identify `side: base | head`. `commitSha` and the top-level scan/checks still describe only the head, preserving existing clients and repair eligibility. Existing import repair actions remain at the detailed check; the comparison generates no patch.

### Context on each finding

For PR reports, each current finding in `checks[].findings[]` also carries `prOrigin: introduced | existing | uncertain`. This is derived when reading the report, including reports saved before this UI upgrade; it requires no rescan or extra allowance. Ordinary report findings keep their original shape.

The detailed report shows new and uncertain findings immediately. Already-present findings stay available in a closed, keyboard-accessible disclosure for each check. The origin label is distinct from severity: a new observation is not automatically a confirmed failure, and an old red finding still counts in the full check result and Action gate. Missing/mismatched context is uncertain. Base-only observations never appear as current findings. Matching consumes duplicate observations individually without modifying saved scan evidence.

`tests/pr-finding-context.test.ts` covers exact per-finding context, duplicate counts, cross-check separation, stale/partial/unmatched context, legacy API compatibility, preservation of overall status, and rendered disclosures/escaping in both languages.

## Accuracy

- Match by check, rule, file and exact problem text. Ignore line movement; count duplicate occurrences independently. A changed severity alone does not fabricate a new problem.
- Apply GitHub's explicit rename map. At the 300-file comparison boundary, rename coverage is uncertain.
- If either snapshot is partial or rename coverage is uncertain, unmatched observations are uncertain, never new or resolved.
- Missing/inapplicable checks, different language titles, different evaluated-rule coverage and coverage-only placeholders are not comparable.
- Configuration-only results without per-finding evidence remain in the full report and are listed as not fully compared.
- Reworded observations can appear separately. No longer detected means exactly that; it does not certify a fix, successful build, fulfillment or checkout.

## Permissions and capacity

One explicit PR request consumes one existing scan allowance and saves one report. Both downloads retain existing archive/file/memory limits, GitHub request budgets and site-wide download semaphore. Requests can receive 429 when capacity is occupied. The route has a 120-second ceiling for two bounded snapshots. No background scans or email subscriptions are added.

Private PRs require the existing paid allowance and an owner-authorized GitHub credential. Private comparisons are saved through the same private report path and inherit the same owner restrictions, noindex and no-store JSON behavior. No source payload or credential is added to reports, logs or browser responses. Public PRs expose only the evidence the ordinary public scan already exposes.

## Regression evidence

`tests/pr-impact.test.ts` exercises real analyzer snapshots (new casing break vs an existing env risk), ignored commented imports, duplicate occurrences, moving lines, renames, partial scans, changed applicability/language, immutable revisions, API JSON compatibility, merge-base resolution, fork rejection and stale-head rejection. `tests/pr-report-route.test.ts` drives the real POST handler through free, paid, private, token, origin and OIDC flows with fake external adapters; allowances are reserved once and failed comparisons release their reservation. No test performs a real purchase or modifies a customer repo.

## Marketplace Action

The merged Action release is `jonjys/deploydoctor-action@ef4c69e41868bf712b6dab3ccc1ea123eb4037c0`. Copy the workflow on [/ci](https://deploydoctor.nyttolabs.com/ci). It requests the comparison only for a matching same-repository PR event/head. Its single comment separates comparison findings from the full-head scan. The existing `fail-on` gate still applies to the full head scan.

This immutable SHA can be installed independently of `v1`. GitHub-hosted workflow jobs currently fail before executing any steps, so moving `v1` and an actual bot-posted comment are not verified. Local Action tests cover 15 passing cases. Do not advertise those remote outcomes as completed.

Private PR metadata additionally needs GitHub Pull requests: read permission, beyond the Contents: read permission used by ordinary scans. Existing GitHub App installations are not silently granted extra permissions by this release. A credential without that access can still scan repository content but cannot perform a private PR comparison. The mocked tests establish owner/entitlement behavior, not the current scopes of a live installation.
