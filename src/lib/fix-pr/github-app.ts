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

export type CheckEvent = { conclusion: string | null; headSha: string | null; prUrls: string[] };

/** Pull request URLs and the conclusion from a check_run or check_suite webhook. */
export function readCheckEvent(payload: unknown): CheckEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { action?: string; repository?: { full_name?: string }; check_run?: CheckNode; check_suite?: CheckNode };
  if (body.action !== "completed") return null;
  const node = body.check_run ?? body.check_suite;
  if (!node) return null;
  const repo = typeof body.repository?.full_name === "string" && /^[\w.-]+\/[\w.-]+$/.test(body.repository.full_name) ? body.repository.full_name : "";
  const prUrls = (node.pull_requests ?? []).flatMap((pull) => {
    if (typeof pull.html_url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pull.html_url)) return [pull.html_url];
    if (repo && typeof pull.number === "number" && Number.isInteger(pull.number) && pull.number > 0) return [`https://github.com/${repo}/pull/${pull.number}`];
    return [];
  });
  return { conclusion: typeof node.conclusion === "string" ? node.conclusion : null, headSha: typeof node.head_sha === "string" ? node.head_sha : null, prUrls };
}

type CheckNode = { conclusion?: string | null; head_sha?: string; pull_requests?: Array<{ html_url?: string; number?: number }> };

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
