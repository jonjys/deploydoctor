# DeployDoctor SEO rollout — 2026-10-21

## Release
Ten new unique English troubleshooting guides added to the existing /guides/[slug] route.
They reuse existing per-page titles/descriptions, canonical URLs, TechArticle JSON-LD, internal links, and automatically generated sitemap entries.
No duplicate landing pages, doorway pages or auto-generated query-spam.

## Google Search Console
1. After production deploy and verifying that /sitemap.xml returns all 10 new guide URLs, submit https://deploydoctor.nyttolabs.com/sitemap.xml in Search Console for the verified property.
2. Inspect representative new URLs with URL Inspection and request indexing if useful. Indexing is not guaranteed.
3. Check Pages indexing reports, sitemap discovery, 404 errors and canonical selection after Google crawls.
4. Monitor organic entrances to /guides/<slug>, clicks through to / or /diagnose, scan starts and actual checkout completions. Do not judge success by impressions alone.

## Copy test for one canonical homepage
Do not index 10 near-identical copies of /. Test different H1 + subtitle combinations behind ONE canonical URL and measure conversion by variant:
A: Your Vercel deploy failed. Find out why.
B: Stop guessing why your deploy keeps failing.
C: One repository scan. Clearer next steps.
D: Vercel errors, explained.
E: Find deployment problems before you deploy.
F: Why won't your app deploy?
G: Less debugging. More shipping.
H: Make your next deploy less stressful.
I: See what's risky before you push.
J: Don't lose another evening to a failed deploy.

Implement a stable cookie-based assignment and event tracking before calling this an A/B test. Change only one variable at a time. Keep paid/free claims true. No copy experiments are activated by this SEO release.
