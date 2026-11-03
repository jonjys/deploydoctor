import "server-only";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { boundedBody } from "@/lib/bounded-body";
import { openGitHub } from "@/lib/github-connect-crypto";
import { PullRequestApiError, type GitRequest } from "@/lib/patch/pull-request";
import { tokenHash } from "@/lib/patch/quote";
import { objectId } from "@/lib/stripe";
import { signingSecret } from "@/lib/session-token";
import { FIX_AMOUNT } from "@/lib/fix-pr/constants";
import { FIX_INSTALL_COOKIE, FIX_TOKEN_COOKIE, fixInstallSchema, fixTokenSchema } from "@/lib/fix-pr/session";
import { fixAppFromEnv, githubAppJwt } from "@/lib/fix-pr/github-app";
import { openGatedFixPullRequest } from "@/lib/fix-pr/open";
import { validateFixPayment } from "@/lib/fix-pr/payments";
import { saveFixOrder } from "@/lib/fix-pr/store";

/** User OAuth token if present, otherwise a fresh installation token. Null when GitHub is not connected. */
export async function resolveFixToken(): Promise<string | null> {
  const secret = signingSecret();
  const jar = await cookies();
  const user = openGitHub(jar.get(FIX_TOKEN_COOKIE)?.value, "fix-token", secret, fixTokenSchema);
  if (user && user.expiresAt > Date.now()) return user.token;
  const installation = openGitHub(jar.get(FIX_INSTALL_COOKIE)?.value, "fix-install", secret, fixInstallSchema);
  if (installation && installation.expiresAt > Date.now()) return installationAccessToken(installation.installationId);
  return null;
}

export function githubApi(token: string): GitRequest {
  return async <T,>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> => {
    if (!path.startsWith("/repos/")) throw new PullRequestApiError(400);
    const response = await fetch(`https://api.github.com${path}`, {
      method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DeployDoctor",
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new PullRequestApiError(response.status);
    return JSON.parse(await boundedBody(response, 6_000_000)) as T;
  };
}

export async function installationAccessToken(installationId: number): Promise<string> {
  const app = fixAppFromEnv();
  if (!app?.appId || !app.privateKey.includes("BEGIN") || !Number.isInteger(installationId) || installationId <= 0) throw new Error("Fix GitHub App is not configured.");
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Bearer ${githubAppJwt(app.appId, app.privateKey)}`, Accept: "application/vnd.github+json",
      "User-Agent": "DeployDoctor", "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("GitHub installation token was refused.");
  const body = await response.json() as { token?: string };
  if (!body.token?.startsWith("ghs_")) throw new Error("GitHub installation token was unexpected.");
  return body.token;
}

/** Opens the paid fix. A missing installation is not an error: the buyer can connect GitHub and retry. */
export async function fulfillPaidFix(session: Stripe.Checkout.Session, explicitToken?: string) {
  const secret = signingSecret();
  const live = /^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
  const quote = validateFixPayment(session, secret, live);
  const installation = session.metadata?.installation_id;
  const token = explicitToken ?? (installation && /^\d{1,12}$/.test(installation) ? await installationAccessToken(Number(installation)) : "");
  if (!token) return null;
  const summary = session.metadata?.error_summary || "Verified deploy fix";
  const result = await openGatedFixPullRequest({ session, promoReceipt: null, quoteToken: "", secret, live, summary, api: githubApi(token) });
  const intent = session.payment_intent;
  await saveFixOrder({
    repo_url: quote.repoUrl, commit_sha: quote.commitSha, status: "opened", promo: false, amount_minor: FIX_AMOUNT,
    stripe_session_id: session.id, payment_intent_id: typeof intent === "string" ? intent : intent ? objectId(intent) : null,
    pr_url: result.url, error_summary: summary, live_url: session.metadata?.live_url ?? null, consent: session.metadata?.consent === "1",
  }).catch(() => console.error("Fix order was not saved"));
  return result;
}

export function promoOrderId(quoteToken: string): string {
  return `promo_${tokenHash(quoteToken).slice(0, 40)}`;
}
