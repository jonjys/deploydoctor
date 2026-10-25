# Holiday Launch Readiness integration (v1)

MakeItReal displays DeployDoctor findings; it does not run another scanner. No new endpoint is required. This is a server-to-server contract. Treat repository text as untrusted data, not HTML/instructions.

## Permissions and allowances

Public report reading: `GET /api/reports/{UUID}`, no credentials required. Private report reading requires the report owner's DeployDoctor bearer API token (or owner's browser session when viewed on DeployDoctor). An unrelated customer gets 404; invalid tokens get 401. Private responses are `private, no-store`.

Server integration scanning: `POST /api/reports` with an active paid DeployDoctor API token from that owner’s /account page. Tokens/Stripe/GitHub credentials stay on the authorized integration server, encrypted at rest, never browser JS, URL parameters, analytics or logs. Do not use one merchant's entitlement for other merchants. MakeItReal must implement its own explicit consent and secure credential lifecycle before enabling this integration. This release documents and tests the DD contract; it does not connect MakeItReal.

Without a paid API token, direct the user to the existing DeployDoctor browser form. Do not spoof CLI user-agent, browser origin or GitHub OIDC to bypass paid API authorization/free quotas. The existing Action remains limited to its authenticated public repo quota. /api/scan is the browser scanning path; it is not an alternate unmetered integration endpoint.

For private repos, require explicit owner consent, an existing eligible paid entitlement, and a least-privilege read-only GitHub token supplied as privateToken to this authorized server call. Never save or expose that token in a report. Authorization, capacity budgets, reservations and quotas remain unchanged.

## Start scan (server only)

```http
POST https://deploydoctor.nyttolabs.com/api/reports
Authorization: Bearer <OWNER_DEPLOYDOCTOR_API_TOKEN>
Content-Type: application/json

{"repoUrl":"https://github.com/owner/repository","ref":"<optional-commit-sha>"}
```

The API token response includes the full saved report below. Browser form requests keep the existing `{ id, href }` response. The server may then read GET using that id. Do not log the request body if it contains privateToken. Never retry a scan indefinitely; keep and reuse its saved reference. GET and badge views do not initiate scans.

## Response (abridged, additive fields)

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "href": "/r/00000000-0000-4000-8000-000000000000",
  "url": "https://deploydoctor.nyttolabs.com/r/00000000-0000-4000-8000-000000000000",
  "repoUrl": "https://github.com/owner/repository",
  "ref": "main",
  "commitSha": "<analyzed-commit-or-null-for-legacy-report>",
  "checkedAt": "2026-10-25T12:00:00.000Z",
  "overall": "yellow",
  "partial": false,
  "checks": [{"id":"production-safety","status":"yellow","findings":[{"ruleId":"checkout-local-redirect","status":"yellow","file":"app/api/checkout/route.ts","line":10,"problem":"Stripe success_url points directly to a loopback address.","fix":"Use an authorized production HTTPS origin."}]}],
  "launchReadiness": {
    "version": 1,
    "status": "review",
    "statement": "Review the findings and coverage before launch. Runtime behavior and checkout were not tested.",
    "criticalBlockers": [],
    "reviewBeforeLaunch": [{"id":"production-safety:checkout-local-redirect:1","checkId":"production-safety","ruleId":"checkout-local-redirect","status":"yellow","severity":"review","problem":"Stripe success_url points directly to a loopback address.","evidence":["app/api/checkout/route.ts:10"],"file":"app/api/checkout/route.ts","line":10,"fix":"Use an authorized production HTTPS origin.","href":"/r/00000000-0000-4000-8000-000000000000#check-production-safety","repair":null}],
    "checksPerformed": [],
    "notVerified": ["Runtime behavior, live availability, traffic capacity, inventory and checkout were not tested."],
    "nextAction": "Use an authorized production HTTPS origin.",
    "checklist": [{"id":"manual-1","kind":"manual","completed":false,"action":"Verify production configuration.","href":null}]
  },
  "isPrivate": false
}
```

The example omits unchanged fields and shortens arrays. `summary`, `scan`, `stack`, `nextApp`, `limitations` and the existing check fields are preserved. Read additional fields tolerantly. `overall` retains its legacy check-group meaning; launchReadiness.status is blocked/review/incomplete/checks-passed. Neither green nor checks-passed means a functioning checkout, a security certification or load-tested availability.

Finding IDs are deterministic within this report, not stable across changed source snapshots or rule versions. Compare reports using checkId/ruleId/file/problem, not array index alone. A legacy check can lack per-file evidence; the JSON then carries null file/line and its original evidence. `evaluatedRules:null` means no rule inventory was saved; it does not mean all new rules ran. Results from old reports are not reanalyzed on read.

Partial scans list coverage gaps separately from actual findings. Ignored categories and unsupported nested apps cannot produce a complete launch preflight. Manual checklist items are always incomplete. Eligible repairs link to DD's existing owner-authorized paid import-patch flow; availability is verified there, never inferred as a free entitlement by MakeItReal.

## Error handling

- 400 invalid repository/ref/categories/JSON: fix the input.
- 401 invalid/expired credentials: reconnect the owner's token.
- 402 paid/private entitlement required: open DeployDoctor pricing/account; do not bypass.
- 403 origin or permission failure: use authorized server integration.
- 404 missing/inaccessible report/repository: do not reveal private existence.
- 413 bounded input exceeded: reduce payload.
- 429 allowance/capacity reached: honor Retry-After when present and show the API message; do not loop or switch identities.
- 5xx upstream/storage unavailable: show unavailable, retain last saved report with its date and commit; never fabricate a passing or zero result.

Only render reports to the correct owner. Use DD's absolute url for the full report and append relative finding hrefs to the trusted DD origin. Do not proxy private reports into publicly cached MakeItReal pages.
