import { analyzeGitHubRepository, GitHubApiError } from "@/lib/github";
import { saveReport } from "@/lib/reports";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 10_000) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }

    const body = (await request.json()) as { repoUrl?: unknown };
    if (typeof body.repoUrl !== "string" || body.repoUrl.length > 300) {
      return Response.json({ error: "Enter a public GitHub repository URL." }, { status: 400 });
    }

    const { canonicalUrl, results } = await analyzeGitHubRepository(body.repoUrl);
    const report = await saveReport(canonicalUrl, results);
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

    console.error("Report generation failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "The report could not be generated." },
      { status: 500 },
    );
  }
}
