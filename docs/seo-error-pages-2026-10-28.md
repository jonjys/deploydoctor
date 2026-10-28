# Vercel error reference pages, 2026-10-28

## What was added
Ten short pages at `/errors/[slug]`, plus an index at `/errors`. Each page covers one common Vercel deployment error and carries:
- the error as it appears in Vercel or the build log,
- fix steps taken from the official Vercel or Next.js documentation (source links on the page, with the date the docs were checked),
- one paragraph on what a DeployDoctor repository scan can and cannot see for that error,
- the existing 24-hour pass checkout button (`ScanCheckoutButton plan="day"`, the same component `/pricing` uses), the free public scan and the log diagnosis link,
- links to the longer `/guides` pages on the same topic, and to the other error pages.

Content lives in `src/lib/error-pages.ts`. Sitemap entries are added in `src/app/sitemap.ts`; `/guides` links to `/errors`.

## Not changed
Checkout, paywall, Stripe, Supabase and Vercel configuration. No new Stripe objects. The pages read no environment variables.

## Rules for adding a page
- Add an entry to `errorPages`. Every fix step must come from a documentation page listed in `docs`; re-check the page and update `updated`.
- State what a scan cannot see. Do not claim a scan fixes the error, runs code or detects runtime behavior.
- `tests/error-pages.test.ts` enforces unique slugs, official documentation hosts, plain copy (no emoji, hashtags, dashes, urgency or unsupported numbers), sitemap coverage and the checkout component.

## Search Console
After the production deploy, confirm `/sitemap.xml` lists `/errors` and the ten pages, then submit it for the verified property. Indexing is not guaranteed. Judge the pages by clicks to `/`, `/diagnose` and `/checkout?plan=day`, not by impressions.
