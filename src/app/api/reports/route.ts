import { githubConnection } from "@/lib/github-connect";
import { analyzeGitHubPullRequest } from "@/lib/github-pull-request";
import { pullRequestFromInput } from "@/lib/repo-input";
import { workLimitResponse } from "@/lib/work-budget";
import { analyzeGitHubRepository, GitHubApiError, parseGitHubRepoUrl } from "@/lib/github";
import { parseGitRef } from "@/lib/git-ref";
import { saveReport } from "@/lib/reports";
import { activePlan, bearerToken, finishScan, requestCustomer, reserveScan, type Entitlement } from "@/lib/access";
import { scanAllowance } from "@/lib/limits";
import { maybePrivateRepo, needsTokenPrompt } from "@/lib/github-status";
import { OIDC_HEADER, verifyGitHubOidc } from "@/lib/github-oidc";
import { sameOrigin } from "@/lib/stripe";
import { fromCli } from "@/lib/cli-client";
import { parseChecks } from "@/lib/categories";
import { allowsPrivate } from "@/lib/plans";
import { langFromRequest, t } from "@/lib/i18n";
import { reportJson } from "@/lib/report-json";
import { SITE_URL } from "@/lib/site";

export const maxDuration = 120;

/**
 * Runs a scan and saves the report.
 *
 * Browser: same-origin JSON { repoUrl, checks?, privateToken? }, answered with { id, href }.
 * CI and scripts: `Authorization: Bearer ddt_...` (an API token from /account), same body plus an optional
 * `ref` (branch, tag or commit), answered with the full report as JSON. A token needs an active pass and
 * is never subject to the free daily limit, so a GitHub Actions runner's shared IP does not matter.
 * Free CI: the GitHub Action sends a GitHub OIDC token in `x-github-oidc-token` instead. It only scans
 * the public repository the workflow runs in, against that repository's own free daily quota.
 * Terminal: `npx deploydoctor` (user-agent deploydoctor-cli/<version>, no Origin header) is answered with the full
 * report as JSON and counts against the visitor's free daily scan exactly like the website form.
 */
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  const { customer, viaToken, invalidToken } = await requestCustomer(request);
  if (invalidToken) return Response.json({ error: t(lang, "err.badToken") }, { status: 401 });
  // Free Action scans: GitHub vouches for the repository; an API token, when sent, always wins.
  let oidcRepo: string | null = null;
  const oidcToken = bearerToken(request) === null ? request.headers.get(OIDC_HEADER) : null;
  if (oidcToken) {
    const claims = await verifyGitHubOidc(oidcToken, SITE_URL);
    if (!claims) return Response.json({ error: t(lang, "err.badOidc") }, { status: 401 });
    if (claims.repository_visibility !== "public") {
      return Response.json({ error: t(lang, "err.oidcPrivate"), paywall: true, pricingUrl: `${SITE_URL}/pricing` }, { status: 402 });
    }
    oidcRepo = claims.repository;
  }
  const viaCi = viaToken || oidcRepo !== null;
  // The CLI cannot send a browser origin; fromCli never matches a browser, and the daily limit below still applies.
  const viaCli = !viaCi && fromCli(request);
  if (!viaCi && !viaCli && !sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  let reservation: string | undefined;
  let saved = false;
  // Outside the try so a GitHub error can tell a possibly private repo from a plain typo.
  let plan: Entitlement | null = null;
  let privateToken: string | undefined;
  let connectedCredential = false;
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 10_000) {
      return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown; checks?: unknown; ref?: unknown; pullRequest?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: t(lang, "err.repoUrl") }, { status: 400 });
    }

    const target = pullRequestFromInput(body.repoUrl);
    const parsed = parseGitHubRepoUrl(target?.repoUrl ?? body.repoUrl);
    const pullRequest = body.pullRequest ?? target?.number;
    if (pullRequest !== undefined && (typeof pullRequest !== "number" || !Number.isSafeInteger(pullRequest) || pullRequest < 1 || pullRequest > 999_999_999 || (target && target.number !== pullRequest))) {
      return Response.json({ error: "Enter a valid, matching pull request number." }, { status: 400 });
    }
    if (oidcRepo && `${parsed.owner}/${parsed.name}`.toLowerCase() !== oidcRepo.toLowerCase()) {
      return Response.json({ error: t(lang, "err.oidcRepo") }, { status: 403 });
    }
    // Validate before reserving a scan so a bad payload never costs one of the day's free scans.
    const checks = parseChecks(body.checks);
    if (checks === null) return Response.json({ error: t(lang, "err.badChecks") }, { status: 400 });
    const ref = viaCi ? parseGitRef(body.ref) : undefined;
    if (ref === null) return Response.json({ error: t(lang, "err.badRef") }, { status: 400 });
    if (pullRequest && body.ref !== undefined && (typeof body.ref !== "string" || !/^[a-f0-9]{40}$/i.test(body.ref))) return Response.json({ error: "A PR comparison accepts only its exact head commit as ref." }, { status: 400 });
    plan = await activePlan(customer);
    if (viaToken && !plan) return Response.json({ error: t(lang, "err.tokenPlan"), paywall: true, pricingUrl: `${SITE_URL}/pricing` }, { status: 402 });
    privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken && (oidcRepo || !allowsPrivate(plan?.plan) || privateToken.length > 300)) {
      console.log("dd-funnel", JSON.stringify({ step: "paywall", plan: plan?.plan ?? null, reason: "private" }));
      // Without a pass the form shows the private repo offer, not the daily limit text.
      return Response.json({ error: t(lang, "err.privatePlan"), paywall: true, privateRepo: !viaCi && !plan }, { status: 402 });
    }
    if (!privateToken && !viaCi && !viaCli && allowsPrivate(plan?.plan)) {
      const connection = await githubConnection(customer);
      if (connection) { privateToken = connection.token; connectedCredential = true; }
    }
    if (!plan) {
      const allowance = scanAllowance(oidcRepo);
      const quota = await reserveScan(request, allowance);
      if (!quota.allowed) {
        console.log("dd-funnel", JSON.stringify({ step: "paywall", plan: null, reason: "limit" }));
        // A free Action scan counts per repository, so it names that allowance instead of the visitor's daily scan.
        return Response.json({ error: oidcRepo ? t(lang, "err.actionLimit", { n: allowance.limit }) : t(lang, "err.dailyLimit"),
          paywall: true, resetsAt: quota.resetsAt, pricingUrl: `${SITE_URL}/pricing` }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(quota.resetsAt) - Date.now()) / 1000))) } });
      }
      reservation = quota.id;
    }
    console.log("dd-funnel", JSON.stringify({ step: "scan_started", source: viaCi ? "ci" : viaCli ? "cli" : "web", paid: Boolean(plan) }));
    const { canonicalUrl, results, isPrivate } = pullRequest
      ? await analyzeGitHubPullRequest(parsed.canonicalUrl, pullRequest, { privateToken, checks, lang, expectedHeadSha: typeof body.ref === "string" ? body.ref : undefined })
      : await analyzeGitHubRepository(body.repoUrl, { privateToken, checks, lang, ref });
    const report = await saveReport(canonicalUrl, results, customer?.customerId, isPrivate);
    saved = true;
    console.log("dd-funnel", JSON.stringify({ step: "scan_completed", source: viaCi ? "ci" : viaCli ? "cli" : "web", partial: results.scan.partial }));
    if (viaCi || viaCli) return Response.json(reportJson(report), { status: 201, headers: { "Cache-Control": "no-store" } });
    return Response.json({ id: report.id, href: `/r/${report.id}` }, { status: 201 });
  } catch (error) {
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    if (error instanceof SyntaxError) {
      return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    }
    if (error instanceof GitHubApiError) {
      if (connectedCredential && [401, 403, 404].includes(error.status)) return Response.json({ error: t(lang, "gh.connectNeeded"), needsGitHub: true }, { status: error.status });
      if (!viaCi && !plan && maybePrivateRepo(error.key, privateToken)) {
        console.log("dd-funnel", JSON.stringify({ step: "paywall", plan: null, reason: "maybe_private" }));
        return Response.json({ error: t(lang, "gh.maybePrivate"), paywall: true, privateRepo: true }, { status: error.status });
      }
      // needsToken opens the private token field in the form.
      if (!viaCi && needsTokenPrompt(error.key, plan?.plan, privateToken)) {
        return Response.json({ error: t(lang, "gh.connectNeeded"), needsToken: true, needsGitHub: true }, { status: error.status });
      }
      return Response.json({ error: error.localized(lang) }, { status: error.status });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return Response.json({ error: t(lang, "err.timeout") }, { status: 504 });
    }

    console.error("Report generation failed:", error instanceof Error ? error.name : "unknown");
    return Response.json(
      { error: t(lang, "err.saveFailed") },
      { status: 500 },
    );
  } finally {
    if (reservation) await finishScan(reservation, saved).catch(() => console.error("Quota completion failed"));
  }
}
