/** The npx deploydoctor CLI (cli/bin.mjs) identifies itself with this user-agent prefix, followed by its version. */
export const CLI_USER_AGENT_PREFIX = "deploydoctor-cli/";

/**
 * True for a POST from the deploydoctor CLI, which has no browser origin to send. This is safe to let past the
 * same-origin check: a browser always sends an Origin header on a POST, and a page cannot set User-Agent
 * without a CORS preflight that this API never answers, so a cross-site page can never match. It changes
 * nothing else: the CLI has no cookie or API token, so the free daily limit per IP and the paywall apply.
 */
export function fromCli(request: Request): boolean {
  return !request.headers.has("origin") && (request.headers.get("user-agent") ?? "").startsWith(CLI_USER_AGENT_PREFIX);
}
