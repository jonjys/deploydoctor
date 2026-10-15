import { NOT_FOUND_PATH, repoFromPath } from "@/lib/repo-link";

type Params = { owner: string; repo: string; rest?: string[] };

/**
 * Instant repo links: /vercel/commerce (or /github.com/vercel/commerce/tree/main) opens the home page with
 * ?repo=vercel/commerce, where the form starts the scan. Every static route and public file is matched first.
 * Anything else goes to the app's not-found page: notFound() in a route handler only sends an empty 404.
 */
export async function GET(request: Request, { params }: { params: Promise<Params> }) {
  const { owner, repo, rest = [] } = await params;
  const found = repoFromPath([owner, repo, ...rest]);
  if (!found) return Response.redirect(new URL(NOT_FOUND_PATH, request.url), 302);
  return Response.redirect(new URL(`/?repo=${found}`, request.url), 302);
}

// Unknown paths such as POST /api/typo/x keep their 404 instead of the 405 a GET-only handler would send.
function notFound() {
  return new Response(null, { status: 404 });
}
export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
