import { cookies } from "next/headers";
import { z } from "zod";
import { boundedBody } from "@/lib/bounded-body";
import { hashRequestIp } from "@/lib/access";
import { PATCH_HEADERS } from "@/lib/patch/delivery";
import { PATCH_ACCESS_COOKIE, readAccessKeys } from "@/lib/patch/payments";
import { retrievePaidPatch } from "@/lib/patch/service";
import { tokenHash } from "@/lib/patch/quote";
import { PatchError } from "@/lib/patch/case-patch";
import { openPaidPatchPullRequest, PullRequestApiError, type GitRequest } from "@/lib/patch/pull-request";
import { sameOrigin } from "@/lib/stripe";
import { acquireWork, releaseWork, workLimitResponse } from "@/lib/work-budget";
import { langFromRequest } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = z.object({ sessionId: z.string().regex(/^cs_(?:live|test)_[A-Za-z0-9]{10,200}$/), githubToken: z.string().regex(/^[A-Za-z0-9_]{20,300}$/), consent: z.literal(true) });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers: PATCH_HEADERS });
  let lease: string | null = null;
  try {
    const parsed = input.safeParse(JSON.parse(await boundedBody(request, 1500)));
    if (!parsed.success) return Response.json({ error: "Confirm the draft PR and supply a repository token." }, { status: 400, headers: PATCH_HEADERS });
    const { sessionId, githubToken } = parsed.data;
    await acquireWork([{ key: `patch-pr:${hashRequestIp(request)}`, limit: 3, seconds: 60 }, { key: "patch-pr:site", limit: 20, seconds: 60 }]);
    const keys = readAccessKeys((await cookies()).get(PATCH_ACCESS_COOKIE)?.value);
    // Server-side owner, live payment, refund and dispute checks, on every attempt including retries.
    lease = await acquireWork([], `patch-pr:${tokenHash(sessionId)}`, 1, 70);
    const api: GitRequest = async <T,>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> => {
      // Only service-built repository API paths. Never accept a URL from the browser or follow a redirect with a token.
      const response = await fetch(`https://api.github.com${path}`, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DeployDoctor", Authorization: `Bearer ${githubToken}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw new PullRequestApiError(response.status);
      return JSON.parse(await boundedBody(response, 6_000_000)) as T;
    };
    const result = await openPaidPatchPullRequest(sessionId, keys, tokenHash(sessionId).slice(0, 24), retrievePaidPatch, api);
    console.log("dd-funnel", JSON.stringify({ step: "patch_pr", reused: result.reused }));
    return Response.json(result, { headers: PATCH_HEADERS });
  } catch (error) {
    const limited = workLimitResponse(error, langFromRequest(request));
    if (limited) return limited;
    if (error instanceof PatchError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: PATCH_HEADERS });
    if (error instanceof PullRequestApiError) return Response.json({ error: error.message }, { status: error.status === 401 || error.status === 403 ? 403 : 503, headers: PATCH_HEADERS });
    return Response.json({ error: error instanceof RangeError || error instanceof SyntaxError ? "Invalid request." : "The pull request could not be opened. Retry with the same order; do not purchase again." }, { status: error instanceof RangeError ? 413 : error instanceof SyntaxError ? 400 : 503, headers: PATCH_HEADERS });
  } finally { if (lease) await releaseWork(lease); }
}
