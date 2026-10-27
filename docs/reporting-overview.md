# Reporting surfaces

DeployDoctor has three reporting surfaces with different audiences:

- `/r/{id}`: the saved repository report. Start with the result and up to three prioritized actions. New changes since the previous scan remain visible; an unchanged comparison is collapsed. Evidence, manual launch verification, passing checks, Watch and badges remain available without repeating the action list.
- `/stats`: anonymous public scan aggregates, with per-check denominators, red/review counts and help links. The layout wraps on small screens. Daily scan volume and methodology expand on demand. The activity ticker remains on the homepage; it is not repeated on its own statistics destination.
- `/growth`: owner-authenticated traffic, complete public scan volume, DeployDoctor paid checkouts and gross paid checkout value. The existing Vercel and Stripe adapters and simulator are preserved. The same finding component/data used on `/stats` is included here.

## Counting and availability

Growth's 7/30-day selector applies to traffic, checkout totals and daily public scan volume using UTC calendar boundaries. The finding rankings and distinct-repository totals explicitly retain the existing rolling 30-day aggregate window. These are independent measurements, not an attributed conversion funnel. Private, partial and demo reports are absent from the public dataset. Scan volume is unavailable if the aggregate has reached its 5,000-row cap rather than presenting a truncated count as exact.

The `complete_scan_insights` migration adds `production-safety` to the existing aggregate's allowlist. It retains the function signature, security invoker, empty search path, grants and old JSON fields. No table, policy, customer record, payment product or private report is modified. Older reports without that group do not count as having passed it.

Missing analytics remains `n/a`; observed gross checkout value excludes deductions and is not net revenue. Campaign attribution/CTA tracking is not invented. The simulator stays hypothetical. MakeItReal continues to read authorized public saved reports through its existing integration; this release does not add private account linking.
