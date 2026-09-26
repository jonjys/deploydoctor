import { activePlan, customerSession } from "@/lib/access";
import { defaultChecks, describeStack } from "@/lib/stack";
import { langFromRequest, t } from "@/lib/i18n";
import { detectRepositoryStack, GitHubApiError } from "@/lib/github";
import { sameOrigin } from "@/lib/stripe";

export const maxDuration = 30;

// Lightweight stack detection for the homepage form. It never touches the daily scan quota.
export async function POST(request: Request) {
  const lang = langFromRequest(request);
  if (!sameOrigin(request)) return Response.json({ error: t(lang, "err.origin") }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: t(lang, "err.tooLarge") }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: t(lang, "err.repoUrl") }, { status: 400 });
    }
    let privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken) {
      const plan = await activePlan(await customerSession());
      if (plan?.plan !== "private" || privateToken.length > 300) privateToken = undefined;
    }
    const { stack } = await detectRepositoryStack(body.repoUrl, { privateToken });
    return Response.json({ stack, summary: describeStack(stack, lang), checks: defaultChecks(stack) });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: t(lang, "err.invalidJson") }, { status: 400 });
    if (error instanceof GitHubApiError) return Response.json({ error: error.localized(lang) }, { status: error.status });
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: t(lang, "err.detectTimeout") }, { status: 504 });
    console.error("Stack detection failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: t(lang, "err.detectFailed") }, { status: 500 });
  }
}
