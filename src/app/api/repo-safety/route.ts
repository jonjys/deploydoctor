import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { sameOrigin } from "@/lib/stripe";
import { activePlan, hashRequestIp, requestCustomer } from "@/lib/access";
import { teaser } from "@/lib/dependency-safety";
import { acquireWork, releaseWork, workLimitResponse } from "@/lib/work-budget";
import { repoSafetyRules } from "@/lib/budget-policy";
import { langFromRequest } from "@/lib/i18n";
import { GitHubApiError } from "@/lib/github";
import { checkRepoSafety } from "@/lib/repo-safety-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Free, public repositories only, nothing stored and nothing run. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Open the check from DeployDoctor." }, { status: 403, headers });
  let lease: string | null = null;
  try {
    const parsed = z.object({ repo: z.string().min(3).max(300) }).safeParse(JSON.parse(await boundedBody(request, 1000)));
    if (!parsed.success) return Response.json({ error: "Paste a GitHub repository link." }, { status: 400, headers });
    lease = await acquireWork(repoSafetyRules(hashRequestIp(request)), "reposafe:active", 4, 70);
    const { report, dependencies } = await checkRepoSafety(parsed.data.repo);
    // The code check is free. The dependency check's details are part of the pass; without one, only the counts.
    const { customer } = await requestCustomer(request).catch(() => ({ customer: null }));
    const paid = Boolean(await activePlan(customer).catch(() => null));
    return Response.json({ ...report, dependencies: dependencies ? (paid ? dependencies : teaser(dependencies)) : null }, { headers });
  } catch (error) {
    const lang = langFromRequest(request);
    const limited = workLimitResponse(error, lang);
    if (limited) return limited;
    if (error instanceof GitHubApiError) return Response.json({ error: error.localized(lang) }, { status: error.status, headers });
    if (error instanceof SyntaxError || error instanceof RangeError) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    console.error("Repo safety check failed");
    return Response.json({ error: "The check could not finish. Try again shortly." }, { status: 503, headers });
  } finally {
    if (lease) await releaseWork(lease);
  }
}
