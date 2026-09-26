import { activePlan, customerSession } from "@/lib/access";
import { defaultChecks, describeStack } from "@/lib/stack";
import { detectRepositoryStack, GitHubApiError } from "@/lib/github";
import { sameOrigin } from "@/lib/stripe";

export const maxDuration = 30;

// Lightweight stack detection for the homepage form. It never touches the daily scan quota.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: "Request body is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: "Enter a public GitHub repository URL." }, { status: 400 });
    }
    let privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken) {
      const plan = await activePlan(await customerSession());
      if (plan?.plan !== "private" || privateToken.length > 300) privateToken = undefined;
    }
    const { stack } = await detectRepositoryStack(body.repoUrl, { privateToken });
    return Response.json({ stack, summary: describeStack(stack), checks: defaultChecks(stack) });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    if (error instanceof GitHubApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: "Stack detection timed out." }, { status: 504 });
    console.error("Stack detection failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Stack detection failed." }, { status: 500 });
  }
}
