import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { sameOrigin } from "@/lib/stripe";
import { hashRequestIp } from "@/lib/access";
import { acquireWork, releaseWork, workLimitResponse } from "@/lib/work-budget";
import { siteCheckRules } from "@/lib/budget-policy";
import { langFromRequest } from "@/lib/i18n";
import { LeakCheckError } from "@/lib/bundle-leaks";
import { checkLiveSite } from "@/lib/site-check";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Free and unsaved: secrets are masked in the result, and nothing about the site is stored. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Open the site check from DeployDoctor." }, { status: 403, headers });
  let lease: string | null = null;
  try {
    const parsed = z.object({ url: z.string().min(4).max(300) }).safeParse(JSON.parse(await boundedBody(request, 1000)));
    if (!parsed.success) return Response.json({ error: "Enter your live site address." }, { status: 400, headers });
    lease = await acquireWork(siteCheckRules(hashRequestIp(request)), "site:active", 3, 60);
    return Response.json(await checkLiveSite(parsed.data.url), { headers });
  } catch (error) {
    const limited = workLimitResponse(error, langFromRequest(request));
    if (limited) return limited;
    if (error instanceof LeakCheckError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyntaxError || error instanceof RangeError) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    console.error("Site check failed");
    return Response.json({ error: "The check could not finish. Try again shortly." }, { status: 503, headers });
  } finally {
    if (lease) await releaseWork(lease);
  }
}
