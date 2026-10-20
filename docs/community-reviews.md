# Visitor reviews and private product feedback

The home page's `#reviews` section accepts public reviews (1–5 stars, alias, text, explicit publication consent) and private improvement ideas. Submissions start pending. The site shows no placeholder testimonials or invented score. The aggregate includes **all published reviews**, while the cards show the six latest. Ratings are labelled visitor reviews, not verified purchases.

## Moderation

Open the DeployDoctor Supabase project → Table Editor → `community_reviews`. Read rows with `status = pending`. Publish legitimate reviews by changing status to `published`. Reject spam, abuse, exposed credentials or personal data with `rejected`. **Apply the same standard to every rating; do not reject negative reviews for their sentiment.** Do not rewrite a visitor's words or turn a private idea into a public review. A database constraint prevents publishing ideas. Keep private feedback and voter hashes private. Delete on the visitor's request or when no longer needed; no email addresses, raw IP addresses or repository information are collected by this form.

A browser can update its existing review or idea; updates return it to pending and remove the old public version until reviewed again. The browser's owner token is HttpOnly; only its HMAC is stored. Losing the cookie loses that automatic association. Shared atomic budgets permit three submissions per IP per UTC day and 100 per site per hour. This reduces casual spam, not all identity abuse. Reviews are not tied to purchases and no claim is made that each reviewer is a unique person.

## Deployment

Apply the included `community_reviews` migration before releasing the UI. Uses existing Supabase service credentials and SESSION_SECRET; no new configuration. RLS is enabled and table/RPC access is restricted to service_role. No public endpoint lists pending submissions. The page reads a field-limited aggregate RPC. If the database is unavailable, the page shows an unavailable message and failed submissions never show success.

## Verification

Run npm test, lint, Next typegen, TypeScript and production build. SQL tests cover publication/consent, private data exclusion, aggregate count/average, six-card limit, duplicate replacement, and role access. API tests cover malformed input, spam trap, origin, size, quotas and fail-closed persistence. Do not add fabricated live reviews as smoke data.

# Activity ticker and /stats

`public_scan_insights()` reads only `reports`, never `private_reports`. Only counts, known check IDs and hour-rounded activity timestamps are returned; repository URLs and findings stay in the database. Up to the 5,000 latest complete public scans within 30 days are used, excluding the three homepage example report IDs. Rankings deduplicate by normalized repo URL and use the latest complete scan per repo; ignored checks are excluded from each denominator. Red and yellow remain separate and the page explicitly explains that findings are risks, not actual failed deployments. Daily volume includes rescans. This is a self-selected sample.

`/api/stats` shares a 60-second server cache and CDN cache. The ticker polls once per minute only while visible, pauses on hover/focus or its Pause button, and disables motion when the system requests reduced motion. No fake activity is generated and failures are labelled. The stats page links to existing guides and scanning; other apps are not promoted without checking their current relevance and availability.
