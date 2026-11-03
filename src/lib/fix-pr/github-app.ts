import { createHmac, createSign, timingSafeEqual } from "node:crypto";

/** GitHub App JWT (RS256). Installation tokens are minted with it and are not stored. */
export function githubAppJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  if (!/^\d{1,12}$/.test(appId) || !privateKey.includes("BEGIN")) throw new Error("GitHub App credentials are incomplete.");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString("base64url");
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  return `${data}.${sign.sign(privateKey).toString("base64url")}`;
}

export function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

/** `X-Hub-Signature-256` from a GitHub App webhook. */
export function verifyGithubWebhook(raw: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = signature.slice("sha256=".length);
  if (got.length !== expected.length || !/^[a-f0-9]+$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}


export type FixAppEnv = { appId: string; privateKey: string; clientId: string; clientSecret: string; slug: string; webhookSecret: string };

export function fixAppFromEnv(env: NodeJS.ProcessEnv = process.env): FixAppEnv | null {
  const appId = env.GITHUB_FIX_APP_ID ?? "";
  const privateKey = normalizePem(env.GITHUB_FIX_APP_PRIVATE_KEY ?? "");
  const clientId = env.GITHUB_FIX_APP_CLIENT_ID ?? "";
  const clientSecret = env.GITHUB_FIX_APP_CLIENT_SECRET ?? "";
  const slug = env.GITHUB_FIX_APP_SLUG ?? "";
  const webhookSecret = env.GITHUB_FIX_WEBHOOK_SECRET ?? "";
  if (!slug && !appId && !clientId) return null;
  return { appId, privateKey, clientId, clientSecret, slug, webhookSecret };
}

export function fixAppCanInstall(app: FixAppEnv | null): boolean {
  return Boolean(app?.slug && app.appId && app.privateKey.includes("BEGIN"));
}

export function fixAppCanAuthorize(app: FixAppEnv | null): boolean {
  return Boolean(app && /^[A-Za-z0-9._-]{5,100}$/.test(app.clientId) && app.clientSecret.length >= 20 && /^[a-z0-9-]{1,100}$/.test(app.slug));
}

/**
 * Fix pull requests are offered, charged and promo-claimed only when the Fix GitHub App can open a pull request
 * (app id, slug and private key) and its webhook can report failed checks for automatic refunds.
 * Without it the diagnosis stays free and nothing is sold.
 */
export function fixPullRequestsEnabled(app: FixAppEnv | null = fixAppFromEnv()): boolean {
  return fixAppCanInstall(app) && (app?.webhookSecret.length ?? 0) >= 16;
}

export const FIX_DISABLED_MESSAGE = "Fix pull requests are not switched on yet. The diagnosis is free and nothing was charged.";

export type StatusEvent = { sha: string; context: string; state: string; repository: string };

/** A `status` webhook (a commit status such as Vercel's deployment result). */
export function readStatusEvent(payload: unknown): StatusEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { sha?: unknown; context?: unknown; state?: unknown; repository?: { full_name?: unknown } };
  if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/.test(body.sha)) return null;
  if (typeof body.context !== "string" || typeof body.state !== "string") return null;
  const repository = typeof body.repository?.full_name === "string" && /^[\w.-]+\/[\w.-]+$/.test(body.repository.full_name) ? body.repository.full_name : "";
  return { sha: body.sha, context: body.context.slice(0, 200), state: body.state, repository };
}
