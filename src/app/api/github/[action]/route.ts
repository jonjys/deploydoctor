import { cookies } from "next/headers";
import { activePlan, customerSession } from "@/lib/access";
import { allowsPrivate } from "@/lib/plans";
import { appOrigin } from "@/lib/site";
import { sameOrigin } from "@/lib/stripe";
import { signingSecret } from "@/lib/session-token";
import { repoUrlFromParam } from "@/lib/repo-input";
import { authorizationUrl, flowSchema, installSchema, matchesState, nonce, openGitHub, sealGitHub } from "@/lib/github-connect-crypto";
import { GH_COOKIE, GH_FLOW, GH_INSTALL, githubApp, githubConnection, githubCookieOptions, githubJson } from "@/lib/github-connect";

export const maxDuration = 30;
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
function home(origin: string, repo: string, result: string) {
  const url = new URL("/", origin); url.searchParams.set("private", "1"); url.searchParams.set("github", result);
  if (repo) url.searchParams.set("repo", repo);
  return url.toString();
}
function redirect(location: string) { return new Response(null, { status: 303, headers: { ...noStore, Location: location } }); }

export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params, origin = appOrigin(request), jar = await cookies();
  if (!["status", "connect", "callback", "install", "installed", "repositories"].includes(action)) return json({ error: "Not found." }, 404);
  const customer = await customerSession();
  const plan = await activePlan(customer);
  const paid = !!customer && allowsPrivate(plan?.plan);
  if (action === "status") {
    const app = await githubApp(); const connection = paid ? await githubConnection(customer) : null;
    return json({ configured: !!app, paid, connected: !!connection, login: connection?.login ?? null, expiresAt: connection?.expiresAt ?? null,
      installUrl: paid && app ? "/api/github/install" : null });
  }
  if (!paid || !customer || !plan) return json({ error: "An active DeployDoctor pass is required to connect private repositories.", paywall: true }, 402);
  const app = await githubApp();
  if (!app && action !== "repositories") return json({ error: "GitHub connection needs one-time activation by the DeployDoctor owner. No personal token is required after activation." }, 503);
  const search = new URL(request.url).searchParams;
  if (action === "connect" && app) {
    const repo = repoUrlFromParam(search.get("repo")) || "", state = nonce(), verifier = nonce();
    jar.set(GH_FLOW, sealGitHub({ state, verifier, customerId: customer.customerId, repo, expiresAt: Date.now() + 600_000 }, "oauth", signingSecret()), { ...githubCookieOptions, maxAge: 600 });
    return redirect(authorizationUrl(app, origin, state, verifier));
  }
  if (action === "install" && app) {
    const state = nonce(), repo = repoUrlFromParam(search.get("repo")) || "";
    jar.set(GH_INSTALL, sealGitHub({ state, repo, customerId: customer.customerId, expiresAt: Date.now() + 600_000 }, "install", signingSecret()), { ...githubCookieOptions, maxAge: 600 });
    return redirect(`https://github.com/apps/${app.slug}/installations/new?state=${state}`);
  }
  if (action === "installed") {
    // installation_id is deliberately ignored. Only a user-authorized token can read repositories.
    const installation = openGitHub(jar.get(GH_INSTALL)?.value, "install", signingSecret(), installSchema);
    jar.delete(GH_INSTALL);
    if (!installation || installation.expiresAt <= Date.now() || installation.customerId !== customer.customerId || !matchesState(search.get("state"), installation.state)) return json({ error: "GitHub installation could not be verified. Connect again." }, 400);
    return redirect(origin + "/api/github/connect?repo=" + encodeURIComponent(installation.repo));
  }
  if (action === "callback" && app) {
    const flow = openGitHub(jar.get(GH_FLOW)?.value, "oauth", signingSecret(), flowSchema);
    jar.delete(GH_FLOW);
    if (!flow || flow.expiresAt <= Date.now() || flow.customerId !== customer.customerId || !matchesState(search.get("state"), flow.state)) return json({ error: "GitHub authorization expired or could not be verified. Connect again." }, 400);
    if (search.has("error")) return redirect(home(origin, flow.repo, "cancelled"));
    const code = search.get("code");
    if (!code || !/^[A-Za-z0-9_-]{1,300}$/.test(code)) return json({ error: "Invalid GitHub authorization response." }, 400);
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: origin + "/api/github/callback", code_verifier: flow.verifier }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("exchange");
      const token = await response.json() as { access_token?: string; expires_in?: number; token_type?: string; error?: string };
      if (token.error || token.token_type !== "bearer" || !/^ghu_[A-Za-z0-9_]{1,296}$/.test(token.access_token ?? "")) throw new Error("token");
      const user = await githubJson("/user", token.access_token!);
      if (typeof user.login !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(user.login)) throw new Error("identity");
      const seconds = Math.min(typeof token.expires_in === "number" && token.expires_in > 0 ? token.expires_in : 8 * 3600, 8 * 3600);
      const expiresAt = Math.min(Date.now() + seconds * 1000, customer.expiresAt, Date.parse(plan.current_period_end));
      jar.set(GH_COOKIE, sealGitHub({ customerId: customer.customerId, token: token.access_token, login: user.login, expiresAt }, "connection", signingSecret()), { ...githubCookieOptions, maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) });
      return redirect(home(origin, flow.repo, "connected"));
    } catch { return redirect(home(origin, flow.repo, "failed")); }
  }
  const connection = await githubConnection(customer);
  if (!connection) return json({ error: "Connect GitHub first.", needsGitHub: true }, 401);
  try {
    const repos = await githubJson("/user/repos?visibility=private&per_page=100&sort=pushed", connection.token);
    if (!Array.isArray(repos)) throw new Error("repos");
    return json({ repositories: repos.filter(r => r.private === true && typeof r.full_name === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.full_name)).slice(0, 100).map(r => ({ name: r.full_name })), limit: 100 });
  } catch { return json({ error: "GitHub could not list repositories. Reconnect or check the repositories selected for DeployDoctor on GitHub.", needsGitHub: true }, 403); }
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return json({ error: "Forbidden." }, 403);
  const action = (await params).action;
  if (action === "token") {
    const customer = await customerSession(), plan = await activePlan(customer);
    if (!customer || !plan || !allowsPrivate(plan.plan)) return json({ error: "An active pass is required." }, 402);
    try {
      if (Number(request.headers.get("content-length") || 0) > 1000) return json({ error: "Request too large." }, 413);
      const raw = await request.text(); if (raw.length > 1000) return json({ error: "Request too large." }, 413);
      const { token } = JSON.parse(raw);
      if (typeof token !== "string" || token.length > 300 || !/^(?:ghp_|github_pat_)[A-Za-z0-9_]+$/.test(token)) return json({ error: "Invalid GitHub token format." }, 400);
      const user = await githubJson("/user", token);
      if (typeof user.login !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(user.login)) throw new Error("identity");
      const expiresAt = Math.min(Date.now() + 8 * 3600_000, customer.expiresAt, Date.parse(plan.current_period_end));
      (await cookies()).set(GH_COOKIE, sealGitHub({ customerId: customer.customerId, token, login: user.login, expiresAt }, "connection", signingSecret()), { ...githubCookieOptions, maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) });
      return json({ connected: true, login: user.login });
    } catch { return json({ error: "GitHub could not authorize this token. Check read permissions and expiry." }, 400); }
  }
  if (action !== "disconnect") return json({ error: "Not found." }, 404);
  const jar = await cookies(); jar.delete(GH_COOKIE); jar.delete(GH_FLOW); jar.delete(GH_INSTALL);
  return json({ connected: false });
}
