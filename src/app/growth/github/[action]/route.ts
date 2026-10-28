import { cookies } from "next/headers";
import { GROWTH_COOKIE, verifyGrowthSession } from "@/lib/growth-auth";
import { signingSecret } from "@/lib/session-token";
import { GH_SETUP, githubApp, githubCookieOptions, saveGitHubApp } from "@/lib/github-connect";
import { githubManifest, matchesState, nonce, openGitHub, parseAppConfig, sealGitHub, setupSchema } from "@/lib/github-connect-crypto";
import { appOrigin } from "@/lib/site";
import { sameOrigin } from "@/lib/stripe";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const jar = await cookies();
  if (!sameOrigin(request) || !verifyGrowthSession(jar.get(GROWTH_COOKIE)?.value, process.env.GROWTH_DASHBOARD_PASSWORD)) return new Response("Forbidden", { status: 403, headers });
  if ((await params).action !== "setup") return new Response("Not found", { status: 404, headers });
  if (await githubApp()) return new Response("GitHub is already configured.", { status: 409, headers });
  const origin = appOrigin(request), state = nonce();
  jar.set(GH_SETUP, sealGitHub({ state, expiresAt: Date.now() + 600_000 }, "setup", signingSecret()), { ...githubCookieOptions, maxAge: 600, path: "/growth/github" });
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activate GitHub for DeployDoctor</title><body><main><h1>Activate GitHub for DeployDoctor</h1><p>One-time owner setup. GitHub will register a public app with read-only contents and metadata access. Customers choose which repositories it may read. No code-write or payment permission is requested.</p><p>Register it under the GitHub account that should own DeployDoctor. The configuration returns directly to this server and is encrypted. No copying tokens or secrets.</p><form method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(githubManifest(origin)))}"><button type="submit">Continue to GitHub and review app</button></form></main></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action https://github.com; frame-ancestors 'none'; base-uri 'none'" } });
}
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== "callback") return new Response("Not found", { status: 404, headers });
  const jar = await cookies(), search = new URL(request.url).searchParams;
  // This short-lived encrypted cookie is issued only after owner authentication. The existing owner cookie is
  // SameSite=Strict and is not sent on GitHub's return navigation, so it cannot authenticate this callback.
  const setup = openGitHub(jar.get(GH_SETUP)?.value, "setup", signingSecret(), setupSchema);
  jar.set(GH_SETUP, "", { ...githubCookieOptions, maxAge: 0, path: "/growth/github" });
  if (!setup || setup.expiresAt <= Date.now() || !matchesState(search.get("state"), setup.state)) return new Response("Setup expired or invalid. Start again from Growth HQ.", { status: 400, headers });
  const code = search.get("code");
  if (!code || !/^[A-Za-z0-9_-]{1,300}$/.test(code)) return new Response("Invalid setup response.", { status: 400, headers });
  if (await githubApp()) return new Response("GitHub is already configured. Existing settings were kept.", { status: 409, headers });
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: "POST", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("conversion");
    const app = await response.json();
    // Reject a registration with unexpected privileges or destinations. Private keys and webhook secrets are discarded.
    const origin = appOrigin(request);
    if ((typeof app.external_url !== "string" || app.external_url.replace(/\/$/, "") !== origin) || app.permissions?.contents !== "read" || Object.entries(app.permissions ?? {}).some(([key, value]) => !["contents", "metadata"].includes(key) || value !== "read")) throw new Error("permissions");
    await saveGitHubApp(parseAppConfig({ clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug }));
    return new Response(null, { status: 303, headers: { ...headers, Location: origin + "/growth?github=ready" } });
  } catch { return new Response("GitHub setup could not be saved. Existing settings were not changed. Check GitHub App registration and try again from Growth HQ; do not paste secrets into chat.", { status: 503, headers }); }
}
