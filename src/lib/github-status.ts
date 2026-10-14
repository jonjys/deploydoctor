import type { MessageKey } from "@/lib/i18n";

/**
 * What a failed GitHub API response means for the visitor. With the buyer's own token, GitHub answers
 * 401 for a bad token and 403 or 404 for a repository the token was not given, so all three mean the token cannot read it.
 */
export function githubFailure(status: number, options: { userToken?: boolean; rateLimited?: boolean } = {}): { message: string; status: number; key: MessageKey } {
  if (options.userToken && !options.rateLimited && (status === 401 || status === 403 || status === 404)) {
    return { message: "The GitHub token cannot read this repository.", status: 403, key: "gh.tokenNoAccess" };
  }
  if (status === 404) return { message: "Repository not found; make sure it is public and the URL is correct.", status: 404, key: "gh.notFound" };
  if (status === 403 || status === 429) return { message: "GitHub's API rate limit was reached; add GITHUB_TOKEN or try again later.", status: 429, key: "gh.rateLimit" };
  return { message: `GitHub returned an unexpected ${status} response.`, status: 502, key: "gh.unexpected" };
}

/** GitHub hides a private repository behind a 404 when no token is sent, so a visitor without a pass gets the $2 offer instead of a dead end. */
export function maybePrivateRepo(key: MessageKey | undefined, privateToken?: string): boolean {
  return (key === "gh.notFound" && !privateToken) || key === "gh.privateOnly";
}
