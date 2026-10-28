import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const appSchema = z.object({ clientId: z.string().min(5).max(100), clientSecret: z.string().min(20).max(300), slug: z.string().regex(/^[a-z0-9-]{1,100}$/) });
export type GitHubAppConfig = z.infer<typeof appSchema>;
export const parseAppConfig = (value: unknown) => appSchema.parse(value);
export const connectionSchema = z.object({ customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/), token: z.string().regex(/^(?:ghu_|ghp_|github_pat_)[A-Za-z0-9_]+$/).max(300), login: z.string().max(100), expiresAt: z.number().finite() });
export const flowSchema = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), verifier: z.string().min(43).max(128), customerId: z.string(), repo: z.string().max(300), expiresAt: z.number().finite() });
export const setupSchema = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().finite() });
export const installSchema = setupSchema.extend({ customerId: z.string(), repo: z.string().max(300) });

function key(secret: string, purpose: string) {
  if (secret.length < 32) throw new Error("Connection encryption is not configured.");
  return createHmac("sha256", secret).update("deploydoctor:github:" + purpose + ":v1").digest();
}
/** Separate keys and authenticated contexts for user credentials, OAuth state and owner configuration. */
export function sealGitHub(value: unknown, purpose: string, secret: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
}
export function openGitHub<T>(token: string | undefined, purpose: string, secret: string, schema: z.ZodType<T>): T | null {
  if (!token || token.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(bytes.subarray(-16));
    return schema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8")));
  } catch { return null; }
}
export const nonce = () => randomBytes(32).toString("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export function matchesState(actual: string | null, expected: string) {
  return !!actual && /^[a-f0-9]{64}$/.test(actual) && /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function openConnection(token: string | undefined, customerId: string, secret: string, now = Date.now()) {
  const connection = openGitHub(token, "connection", secret, connectionSchema);
  return connection && connection.customerId === customerId && connection.expiresAt > now && connection.expiresAt <= now + 8 * 3600_000 ? connection : null;
}
export function authorizationUrl(app: GitHubAppConfig, origin: string, state: string, verifier: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: app.clientId, redirect_uri: origin + "/api/github/callback", state, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", allow_signup: "false" }).toString();
  return url.toString();
}
export function githubManifest(origin: string) {
  return { name: "DeployDoctor Repository Scanner", url: origin, description: "Read-only repository deployment checks. No code writes or payment access.", public: true,
    redirect_url: origin + "/growth/github/callback", callback_urls: [origin + "/api/github/callback"], setup_url: origin + "/api/github/installed",
    hook_attributes: { url: origin + "/api/github/events", active: false }, default_permissions: { contents: "read", metadata: "read" }, default_events: [], request_oauth_on_install: false };
}
