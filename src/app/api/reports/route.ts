import { analyzeGitHubRepository, GitHubApiError, parseGitHubRepoUrl } from "@/lib/github";
import { saveReport } from "@/lib/reports";
import { activePlan, customerSession, finishScan, reserveScan } from "@/lib/access";
import { sameOrigin } from "@/lib/stripe";
import { parseChecks } from "@/lib/categories";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  let reservation: string | undefined;
  let saved = false;
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 10_000) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 10_000) return Response.json({ error: "Request body is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { repoUrl?: unknown; privateToken?: unknown; checks?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: "Enter a public GitHub repository URL." }, { status: 400 });
    }

    parseGitHubRepoUrl(body.repoUrl);
    // Validate before reserving a scan so a bad payload never costs one of the day's free scans.
    const checks = parseChecks(body.checks);
    if (checks === null) return Response.json({ error: "Välj minst en giltig kategori att skanna." }, { status: 400 });
    const customer = await customerSession();
    const plan = await activePlan(customer);
    const privateToken = typeof body.privateToken === "string" ? body.privateToken.trim() : undefined;
    if (privateToken && (plan?.plan !== "private" || privateToken.length > 300)) {
      return Response.json({ error: "Privata repon kräver Private ($19/månad).", paywall: true }, { status: 402 });
    }
    if (!plan) {
      const quota = await reserveScan(request);
      if (!quota.allowed) return Response.json({ error: "Du har använt dagens 3 gratis skanningar. Dina sparade rapporter är fortfarande gratis att läsa.",
        paywall: true, resetsAt: quota.resetsAt }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(quota.resetsAt) - Date.now()) / 1000))) } });
      reservation = quota.id;
    }
    const { canonicalUrl, results, isPrivate } = await analyzeGitHubRepository(body.repoUrl, { privateToken, checks });
    const report = await saveReport(canonicalUrl, results, customer?.customerId, isPrivate);
    saved = true;
    return Response.json({ id: report.id, href: `/r/${report.id}` }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (error instanceof GitHubApiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return Response.json({ error: "The repository scan timed out; try again." }, { status: 504 });
    }

    console.error("Report generation failed:", error instanceof Error ? error.name : "unknown");
    return Response.json(
      { error: "Skanningen kunde inte sparas just nu; försök igen. Den räknas inte mot din gräns." },
      { status: 500 },
    );
  } finally {
    if (reservation) await finishScan(reservation, saved).catch(() => console.error("Quota completion failed"));
  }
}
