# Build-log plugin decision — 2026-10-04

## Observed evidence

Google's public US AI search report lists “best ai for coding” first among its “best ai for…” queries. This is a report-specific ranking, not a current global keyword-volume table and not a ranking of debugging errors.
https://trends.withgoogle.com/trends/us/artificial-intelligence-search-trends/

Stack Overflow's 2025 developer survey AI section reports 66% frustration with almost-correct AI solutions and 45% with time-consuming debugging of AI-generated code. This is respondent evidence, not search volume or demonstrated willingness to pay.
https://survey.stackoverflow.co/2025/ai

The opportunity chosen is reducing repeated blind changes after a build error, by pairing a recognized signature with required context and an explicit verification criterion. This is a product inference. No claim is made that these three error families are the most searched problems on Google.

## MVP scope

Add diagnose_build_log to the existing DeployDoctor MCP plugin. Three supported families:
- Module resolution: https://nextjs.org/docs/messages/module-not-found
- npm peer conflicts: https://docs.npmjs.com/cli/v11/using-npm/config/#legacy-peer-deps
- React hydration: https://nextjs.org/docs/messages/react-hydration-error

The tool uses deterministic bounded pattern matching, not an LLM or execution sandbox. It does not fetch repositories, spend scan quota, save submitted logs, return raw log content, or claim a confirmed root cause. Unknown signatures ask for more context. Exact package versions and patches require inspecting the relevant project first.

## Cost and pricing

No new paid provider, model API, database operation, subscription or infrastructure was enabled. The tool runs on existing hosting; ordinary hosting usage remains subject to the existing platform limits. Existing repository-scan allowance and website pricing are unchanged. This is a usability feature for the existing plugin, not a new paid-MCP entitlement or catalog approval.

## Limits and next evidence

Rule coverage is narrow and an apparent match can be incidental. Required context and verification prevent treating a match as a verified fix. Logs must be sanitized before being sent; the user's AI provider and hosting provider have separate data policies. Assess actual use and successful investigations before adding rules or changing prices. Do not advertise search-volume dominance, guaranteed fixes or automatic AI recommendations.
