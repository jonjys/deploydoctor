import { detectionRules } from "@/lib/budget-policy";
import { hashRequestIp } from "@/lib/access";
import { acquireWork, workLimitResponse } from "@/lib/work-budget";
import { activePlan, customerSession } from "@/lib/access";
import { defaultChecks, describeStack } from "@/lib/stack";
import { langFromRequest, t } from "@/lib/i18n";
import { detectRepositoryStack, GitHubApiError } from "@/lib/github";
import { maybePrivateRepo, needsTokenPrompt, tokenPromptKey } from "@/lib/github-status";
import { sameOrigin } from "@/lib/stripe";
import { allowsPrivate } from "@/lib/plans";

export const maxDuration = 30;

// Lightweight stack detection for the homepage form. It never touches the daily scan quota.
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  let privateToken: string | undefined;
  try {
    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: t(lang, "err.repoUrl") }, { status: 400 });
    }
    privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken) {
      const plan = await activePlan(await customerSession());
      if (!allowsPrivate(plan?.plan) || privateToken.length > 300) privateToken = undefined;
    }
    await acquireWork(detectionRules(hashRequestIp(request)));
    const { stack } = await detectRepositoryStack(body.repoUrl, { privateToken });
    return Response.json({ stack, summary: describeStack(stack, lang), checks: defaultChecks(stack) });
  } catch (error) {
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    if (error instanceof GitHubApiError) {
      // The plan is read only on this path: without a pass the visitor gets the $2 offer, with one a prompt to paste
      // a token, and when the plan cannot be read the plain error.
      if (maybePrivateRepo(error.key, privateToken)) {
        const plan = await customerSession().then(activePlan).catch(() => undefined);
        if (plan === null) return Response.json({ error: t(lang, "gh.maybePrivate"), paywall: true, privateRepo: true }, { status: error.status });
        if (needsTokenPrompt(error.key, plan?.plan, privateToken)) {
          return Response.json({ error: t(lang, tokenPromptKey(error.key)), needsToken: true }, { status: error.status });
        }
      }
      return Response.json({ error: error.localized(lang) }, { status: error.status });
    }
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: t(lang, "err.detectTimeout") }, { status: 504 });
    console.error("Stack detection failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "err.detectFailed") }, { status: 500 });
  }
}
