# Visitor reviews and private product feedback

The home page's `#reviews` section accepts public reviews (1–5 stars, alias, text, explicit publication consent) and private improvement ideas. Submissions start pending. The site shows no placeholder testimonials or invented score. The aggregate includes **all published reviews**, while the cards show the six latest. Ratings are labelled visitor reviews, not verified purchases.

## Moderation

Open the DeployDoctor Supabase project → Table Editor → `community_reviews`. Read rows with `status = pending`. Publish legitimate reviews by changing status to `published`. Reject spam, abuse, exposed credentials or personal data with `rejected`. **Apply the same standard to every rating; do not reject negative reviews for their sentiment.** Do not rewrite a visitor's words or turn a private idea into a public review. A database constraint prevents publishing ideas. Keep private feedback and voter hashes private. Delete on the visitor's request or when no longer needed; no email addresses, raw IP addresses or repository information are collected by this form.

A browser can update its existing review or idea; updates return it to pending and remove the old public version until reviewed again. The browser's owner token is HttpOnly; only its HMAC is stored. Losing the cookie loses that automatic association. Shared atomic budgets permit three submissions per IP per UTC day and 100 per site per hour. This reduces casual spam, not all identity abuse. Reviews are not tied to purchases and no claim is made that each reviewer is a unique person.

## Deployment

Apply the included `community_reviews` migration before releasing the UI. Uses existing Supabase service credentials and SESSION_SECRET; no new configuration. RLS is enabled and table/RPC access is restricted to service_role. No public endpoint lists pending submissions. The page reads a field-limited aggregate RPC. If the database is unavailable, the page shows an unavailable message and failed submissions never show success.

## Verification

Run npm test, lint, Next typegen, TypeScript and production build. SQL tests cover publication/consent, private data exclusion, aggregate count/average, six-card limit, duplicate replacement, and role access. API tests cover malformed input, spam trap, origin, size, quotas and fail-closed persistence. Do not add fabricated live reviews as smoke data.
