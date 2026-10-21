# Private Growth HQ (DeployDoctor)

URL: /growth — owner-only, noindex, not in nav or sitemap.

## Required production settings
1. Set GROWTH_DASHBOARD_PASSWORD to a unique random value with at least 24 characters. Never put it in GitHub or a NEXT_PUBLIC variable. Login issues an 8-hour HTTP-only signed cookie; changing the password invalidates sessions.
2. Set GROWTH_VERCEL_API_TOKEN to a personal/team Vercel token with the minimum account access needed to read Web Analytics for DeployDoctor. It remains server-only. This token is not a Stripe key.
3. The existing STRIPE_SECRET_KEY is used for read-only checkout reporting. The production mode of that key determines whether Stripe reports test or live payments.
4. Optional GROWTH_VERCEL_PROJECT_ID and GROWTH_VERCEL_TEAM_ID override the known project/team IDs if the project is moved.
5. Set the variables only in Vercel Production and redeploy after changing them. Neither secret is exposed to the browser.

The /growth page requires a password and is not included in navigation, robots or sitemap. No data is fetched on the unauthenticated request. Keep this dashboard private; do not link it from public marketing pages.

## Semantics
- Traffic: Vercel Web Analytics aggregated unique visitors and pageviews, refreshed when the page loads. Analytics data can have consent, browser and reporting-window limits.
- SEO pages: /guides/* paths ranked by pageviews. These are NOT Google impressions, ranks, search queries or organic clicks.
- Payments: completed paid DeployDoctor Stripe Checkout sessions CREATED in the selected window, grouped by currency. Amounts are gross Checkout totals before refunds, fees, tax adjustments and recurring invoice renewals; do not call them net revenue. Pagination caps at 500 sessions and labels incomplete samples.
- Ratio: paid checkouts / unique visitors over the same window. Not an attributable per-user conversion rate.
- CTA clicks: only displayed if Vercel custom events exist and are supported on the account's plan; missing events are not reported as zero.
- Simulator: fully hypothetical revenue = visitors × percentage conversion × average payment value. Separate from actual financial reporting.

Vercel Web Analytics API: https://vercel.com/changelog/web-analytics-api
Custom events may require a Pro/Enterprise plan: https://vercel.com/docs/analytics/custom-events
Google Search Console can be used separately for search impressions, Google clicks, and query rankings; this app does not request Google credentials.
