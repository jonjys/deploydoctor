import { cookies } from "next/headers";
import { githubJson } from "@/lib/github-connect";
import { matchesState, nonce, openGitHub, pkceChallenge, sealGitHub } from "@/lib/github-connect-crypto";
import { repoFromPath } from "@/lib/repo-link";
import { signingSecret } from "@/lib/session-token";
import { appOrigin } from "@/lib/site";
import { sameOrigin } from "@/lib/stripe";
import { fixAppCanAuthorize, fixAppCanInstall, fixAppFromEnv } from "@/lib/fix-pr/github-app";
import { FIX_FLOW_COOKIE, FIX_INSTALL_COOKIE, FIX_TOKEN_COOKIE, fixCookieOptions, fixFlowSchema, fixInstallSchema, fixTokenSchema } from "@/lib/fix-pr/session";

export const runtime = "nodejs";
export const maxDuration = 30;
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
const redirect = (location: string) => new Response(null, { status: 303, headers: { ...noStore, Location: location } });

function back(origin: string, repo: string, result: string) {
  const url = new URL("/fix", origin);
  url.searchParams.set("github", result);
  if (repo) url.searchParams.set("repo", repo);
  return url.toString();
}

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!["status", "install", "installed", "connect", "callback"].includes(action)) return json({ error: "Not found." }, 404);
  const origin = appOrigin(request);
  const jar = await cookies();
  const app = fixAppFromEnv();
  const search = new URL(request.url).searchParams;
  if (action === "status") {
    let connected = false;
    let login: string | null = null;
    if ((process.env.SESSION_SECRET ?? "").length >= 32) {
      const secret = signingSecret();
      const installation = openGitHub(jar.get(FIX_INSTALL_COOKIE)?.value, "fix-install", secret, fixInstallSchema);
      const user = openGitHub(jar.get(FIX_TOKEN_COOKIE)?.value, "fix-token", secret, fixTokenSchema);
      connected = Boolean((installation && installation.expiresAt > Date.now()) || (user && user.expiresAt > Date.now()));
      login = user && user.expiresAt > Date.now() ? user.login : null;
    }
    return json({ configured: Boolean(app && (fixAppCanInstall(app) || fixAppCanAuthorize(app))), install: fixAppCanInstall(app), authorize: fixAppCanAuthorize(app), connected, login });
  }
  if (!app) return json({ error: "The Fix GitHub App is not configured yet." }, 503);
  const secret = signingSecret();
  const repo = repoFromPath((search.get("repo") ?? "").split("/").filter(Boolean)) ?? "";
  if (action === "install") {
    if (!app.slug) return json({ error: "Set GITHUB_FIX_APP_SLUG to the Fix app." }, 503);
    const state = nonce();
    jar.set(FIX_FLOW_COOKIE, sealGitHub({ state, verifier: nonce(), repo, expiresAt: Date.now() + 600_000 }, "fix-oauth", secret), { ...fixCookieOptions, maxAge: 600 });
    return redirect(`https://github.com/apps/${app.slug}/installations/new?state=${state}`);
  }
  if (action === "connect") {
    if (!fixAppCanAuthorize(app)) return json({ error: "Set the Fix app OAuth client id and secret." }, 503);
    const state = nonce();
    const verifier = nonce();
    jar.set(FIX_FLOW_COOKIE, sealGitHub({ state, verifier, repo, expiresAt: Date.now() + 600_000 }, "fix-oauth", secret), { ...fixCookieOptions, maxAge: 600 });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: app.clientId, redirect_uri: `${origin}/api/fix/github/callback`, state, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", allow_signup: "false" }).toString();
    return redirect(url.toString());
  }
  const flow = openGitHub(jar.get(FIX_FLOW_COOKIE)?.value, "fix-oauth", secret, fixFlowSchema);
  jar.delete(FIX_FLOW_COOKIE);
  if (!flow || flow.expiresAt <= Date.now() || !matchesState(search.get("state"), flow.state)) return json({ error: "GitHub authorization expired. Connect again." }, 400);
  if (action === "installed") {
    const installationId = Number(search.get("installation_id"));
    if (!Number.isInteger(installationId) || installationId <= 0) return json({ error: "GitHub did not confirm an installation." }, 400);
    jar.set(FIX_INSTALL_COOKIE, sealGitHub({ installationId, expiresAt: Date.now() + 8 * 3600_000 }, "fix-install", secret), { ...fixCookieOptions, maxAge: 8 * 3600 });
    return redirect(back(origin, flow.repo, "connected"));
  }
  if (search.has("error")) return redirect(back(origin, flow.repo, "cancelled"));
  const code = search.get("code");
  if (!code || !/^[A-Za-z0-9_-]{1,300}$/.test(code) || !fixAppCanAuthorize(app)) return json({ error: "Invalid GitHub authorization response." }, 400);
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: `${origin}/api/fix/github/callback`, code_verifier: flow.verifier }),
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("exchange");
    const issued = await response.json() as { access_token?: string; expires_in?: number; token_type?: string; error?: string };
    if (issued.error || issued.token_type !== "bearer" || !issued.access_token?.startsWith("ghu_")) throw new Error("token");
    const user = await githubJson("/user", issued.access_token);
    if (typeof user.login !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(user.login)) throw new Error("identity");
    const seconds = Math.min(typeof issued.expires_in === "number" && issued.expires_in > 0 ? issued.expires_in : 8 * 3600, 8 * 3600);
    const expiresAt = Date.now() + seconds * 1000;
    jar.set(FIX_TOKEN_COOKIE, sealGitHub({ token: issued.access_token, login: user.login, expiresAt }, "fix-token", secret), { ...fixCookieOptions, maxAge: seconds });
    return redirect(back(origin, flow.repo, "connected"));
  } catch { return redirect(back(origin, flow.repo, "failed")); }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return json({ error: "Forbidden." }, 403);
  if ((await params).action !== "disconnect") return json({ error: "Not found." }, 404);
  const jar = await cookies();
  jar.delete(FIX_INSTALL_COOKIE); jar.delete(FIX_FLOW_COOKIE); jar.delete(FIX_TOKEN_COOKIE);
  return json({ connected: false });
}
