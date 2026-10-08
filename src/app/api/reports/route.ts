import { analyzeGitHubRepository, GitHubApiError, parseGitHubRepoUrl } from "@/lib/github";
import { parseGitRef } from "@/lib/git-ref";
import { saveReport } from "@/lib/reports";
import { activePlan, bearerToken, finishScan, requestCustomer, reserveScan } from "@/lib/access";
import { OIDC_HEADER, verifyGitHubOidc } from "@/lib/github-oidc";
import { sameOrigin } from "@/lib/stripe";
import { parseChecks } from "@/lib/categories";
import { allowsPrivate } from "@/lib/plans";
import { langFromRequest, t } from "@/lib/i18n";
import { reportJson } from "@/lib/report-json";
import { SITE_URL } from "@/lib/site";

export const maxDuration = 60;

/**
 * Runs a scan and saves the report.
 *
 * Browser: same-origin JSON { repoUrl, checks?, privateToken? }, answered with { id, href }.
 * CI and scripts: `Authorization: Bearer ddt_...` (an API token from /account), same body plus an optional
 * `ref` (branch, tag or commit), answered with the full report as JSON. A token needs an active pass and
 * is never subject to the free daily limit, so a GitHub Actions runner's shared IP does not matter.
 * Free CI: the GitHub Action sends a GitHub OIDC token in `x-github-oidc-token` instead. It only scans
 * the public repository the workflow runs in, against that repository's own free daily quota.
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
  if (!viaCi && !sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  let reservation: string | undefined;
  let saved = false;
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 10_000) {
      return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown; checks?: unknown; ref?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: t(lang, "err.repoUrl") }, { status: 400 });
    }

    const parsed = parseGitHubRepoUrl(body.repoUrl);
    if (oidcRepo && `${parsed.owner}/${parsed.name}`.toLowerCase() !== oidcRepo.toLowerCase()) {
      return Response.json({ error: t(lang, "err.oidcRepo") }, { status: 403 });
    }
    // Validate before reserving a scan so a bad payload never costs one of the day's free scans.
    const checks = parseChecks(body.checks);
    if (checks === null) return Response.json({ error: t(lang, "err.badChecks") }, { status: 400 });
    const ref = viaCi ? parseGitRef(body.ref) : undefined;
    if (ref === null) return Response.json({ error: t(lang, "err.badRef") }, { status: 400 });
    const plan = await activePlan(customer);
    if (viaToken && !plan) return Response.json({ error: t(lang, "err.tokenPlan"), paywall: true, pricingUrl: `${SITE_URL}/pricing` }, { status: 402 });
    const privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken && (oidcRepo || !allowsPrivate(plan?.plan) || privateToken.length > 300)) {
      return Response.json({ error: t(lang, "err.privatePlan"), paywall: true }, { status: 402 });
    }
    if (!plan) {
      const quota = await reserveScan(request, oidcRepo ? `repo:${oidcRepo.toLowerCase()}` : undefined);
      if (!quota.allowed) return Response.json({ error: t(lang, "err.dailyLimit"),
        paywall: true, resetsAt: quota.resetsAt }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(quota.resetsAt) - Date.now()) / 1000))) } });
      reservation = quota.id;
    }
    const { canonicalUrl, results, isPrivate } = await analyzeGitHubRepository(body.repoUrl, { privateToken, checks, lang, ref });
    const report = await saveReport(canonicalUrl, results, customer?.customerId, isPrivate);
    saved = true;
    if (viaCi) return Response.json(reportJson(report), { status: 201, headers: { "Cache-Control": "no-store" } });
    return Response.json({ id: report.id, href: `/r/${report.id}` }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    }
    if (error instanceof GitHubApiError) {
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
