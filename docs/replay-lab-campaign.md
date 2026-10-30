# Break My Checkout — distribution kit

Ship within DeployDoctor. Free replay lab → free public scan → existing $2/24h pass. No new product, price or payment integration.

URL: https://deploydoctor.nyttolabs.com/webhook-replay-lab

Social card: https://deploydoctor.nyttolabs.com/webhook-replay-lab/opengraph-image

## Threads

Your Stripe webhook fires twice. Does your app fulfil the order twice?

I built a replay lab in DeployDoctor to show naive handling beside a duplicate guard.

It runs entirely in your browser. No Stripe keys, no real payments.

A guard still needs failure recovery—claiming an event and crashing is a different bug.

Try the lab, then scan your repo:
https://deploydoctor.nyttolabs.com/webhook-replay-lab?utm_source=threads&utm_medium=social&utm_campaign=break-my-checkout

## X

A successful payment can reach your webhook more than once.

I added a free replay lab to DeployDoctor: compare naive handling with duplicate protection.

Browser simulation. No Stripe keys or real payments.

https://deploydoctor.nyttolabs.com/webhook-replay-lab?utm_source=x&utm_medium=social&utm_campaign=break-my-checkout

## Pinterest

Title: Stripe webhook checklist: one payment, five deliveries

Description: See how duplicate Stripe webhook deliveries, worker restarts and crashes affect access grants. Try the free interactive DeployDoctor lab, then review your own GitHub source for payment and deployment risks. Browser simulation; no Stripe keys or real payments. Static source review does not validate checkout behavior.

Destination: https://deploydoctor.nyttolabs.com/webhook-replay-lab?utm_source=pinterest&utm_medium=social&utm_campaign=break-my-checkout

## Longer own-channel showcase

I stopped trying to explain webhook idempotency with another checklist.

Instead, I made a tiny lab: send one payment event, replay it, then compare the outcome with and without a duplicate guard.

The useful part is the awkward case: what if your handler claims the event, then crashes before granting access? A Set of event IDs is not a production architecture.

The lab is free and runs in your browser. DeployDoctor can also review visible webhook code in a GitHub repo and show evidence to inspect. It does not execute your checkout or prove fulfilment works.

Try it: https://deploydoctor.nyttolabs.com/webhook-replay-lab

## Evidence and measurement

- All lab numbers are simulated access grants, never revenue/customer claims.
- Stripe documentation: https://docs.stripe.com/webhooks#handle-duplicate-events and https://docs.stripe.com/events/manage-webhook-endpoints#process-undelivered-events
- Track actual lab page views and successful payments separately. UTM links label referrals; payment attribution is NOT implemented by this change.
- Checkout creation returned a real live-mode session during the 2026-10-30 audit. No payment was submitted. Paid delivery was not retested.
- Social publication is not complete until a real public post URL is recorded. Browser connection was unavailable at preparation time.
- Use owned channels or a venue that explicitly allows the post. Vercel Community prohibits advertising; do not paste this campaign there. No cold DMs.
- Next decision: if traffic reaches the lab but not the scanner, improve that handoff. If no traffic reaches the lab, work on distribution before adding features.

## Validation before release

- Four behavioral tests cover duplicate replay, worker restart, crash/retry, and different event IDs for the same purchase. All passed.
- Full suite: 403/403 passed. TypeScript check passed after build type generation. The existing route regression test caught the new route missing from the reserved-owner list; that was fixed before release.
- Production build completed with Next.js 16.4.2 and generated the lab and social image routes.
- Independent code review found no material correctness, accessibility or purchase-claim blocker; copy-failure feedback and crash trace wording were improved.
- Visual browser testing is not verified: the available browser could not initialize in this session.

## Published distribution checkpoint — 2026-10-30

- Lab production returned HTTP 200 and the expected simulation, free-scan link and $2 pass CTA in the follow-up check.
- The public Action README already contains the lab → scan → pass links. Do not add another copy: https://github.com/jonjys/deploydoctor-action/blob/main/README.md
- NyttoLabs homepage now promotes the lab inside the existing DeployDoctor card, preserving its free-scan CTA. English and Swedish copy, explicit simulation disclosure, and a 44px link target. Source commit: https://github.com/jonjys/NyttoLabs/commit/b422a8befc780ee05ac41f2f7301031dca392355
- Vercel production deployment dpl_BGVLST72Y4Lzaseqac9zzPSfRqYv reached READY for that exact commit. https://www.nyttolabs.com/ returned the campaign link and disclosure after deployment.
- Referral URL: https://deploydoctor.nyttolabs.com/webhook-replay-lab?utm_source=nyttolabs&utm_medium=portfolio&utm_campaign=break-my-checkout
- Validation: 90 existing NyttoLabs tests passed; production build passed; generated homepage HTML contained exactly one lab campaign link and the original scanner link. Review corrected an inline-link mobile tap-target issue. Visual/interactive browser QA remains unverified.
- Social posts are still NOT published. No connected social publishing tool was available and the browser failed to initialize. Metricool was suggested but its installation/connection is not confirmed. Do not report drafts as posts or repeatedly retry the failed browser.
- Stripe live read showed no charge after the campaign baseline (2026-10-30T20:48:00Z); the latest record was an earlier own purchase, excluded from customer revenue. Do not record customer details or count own purchases as sales. The API response did not apply the bracketed date filter, so the returned latest timestamps were checked directly.
- The existing three-run night automation remains the continuation mechanism. Do not create duplicate schedules. Prioritize a real distribution action when an authorized publishing connection becomes available; do not keep adding features or duplicating this homepage/README placement.

## Metricool connection and first Threads post — 2026-10-30

- Metricool is now connected. Confirmed brand: nyttolabs, blogId 6999637, Threads account @nyttolabs; also TikTok and YouTube. X and Pinterest are not connected in the returned brand settings.
- Checked scheduled posts (30 Oct–1 Nov): empty before creating this post. Checked published Threads posts for 23–30 Oct: no replay-lab campaign duplicate.
- Created exactly ONE Threads post: Metricool id 411721611, uuid 1533553819489354378, autoPublish true, draft false. Returned publication time: 2026-10-30 22:59 Europe/Stockholm. Provider status at creation: PENDING, so publication is not yet verified.
- Planner: https://app.metricool.com/planner/calendar?blogId=6999637&openWithPostUuid=1533553819489354378
- Do NOT recreate this post or publish a second version. First inspect its status and published-post analytics for the public Threads URL; update this record with actual proof.
- Text:
> Your Stripe webhook fires twice. Does your app grant access twice?
> 
> I built a free replay lab in DeployDoctor. Replay one payment, restart the worker, or crash it before access is granted.
> 
> Browser simulation. No Stripe keys or real payments. It doesn't test your app.
> 
> Try it, then scan your repo:
> https://deploydoctor.nyttolabs.com/webhook-replay-lab?utm_source=threads&utm_medium=social&utm_campaign=break-my-checkout


## Coordinated publication verification — 2026-10-30 23:01 Europe/Stockholm

- Target lab was independently fetched again: HTTP 200 with the simulation, free public scan CTA and existing $2/24h pass CTA. No new checkout or payment was submitted.
- First Threads campaign post remains Metricool id 411721611 / uuid 1533553819489354378, autoPublish true, draft false, scheduled for 22:59 Europe/Stockholm. At the 23:01 check, Threads provider status was PENDING / detailedStatus Pending. No actual publication timestamp or public permalink was returned; today's Threads analytics had no rows. This is queued distribution, NOT verified publication.
- First planner: https://app.metricool.com/planner/calendar?blogId=6999637&openWithPostUuid=1533553819489354378
- Cross-chat race: a second worker read an empty queue before the first post became visible and created another campaign post. That later copy (uuid 7611550354215813938) was changed to draft before its 23:00 release; readback twice confirmed draft true. Its current Metricool id is 411722163 (previously 411721789). Leave it as a draft; do not publish or recreate either copy.
- Nytto Labs live Stripe charge search for succeeded charges created after campaign baseline 2026-10-30T20:48:00Z returned no results. Stripe Search can lag; no new customer payment or campaign attribution is verified.
- Updated the existing night automation 6ae5036f36888191ad9844a416478515 to use Metricool, preserve the first Threads post and require a fresh queue/doc read plus an optimistic-SHA reservation before future external publishing actions. No additional automation was created. It is enabled with two remaining scheduled runs: 2026-10-31 02:00 and 05:00 Europe/Stockholm; the service returned next_run_time null, so actual future execution is not yet verified.
- Next action: inspect the FIRST post's actual provider result and permalink, then check traffic/payment evidence. Do not add features or keep polling continuously. X and Pinterest were not connected in Metricool brand settings; browser initialization failed in this session.
