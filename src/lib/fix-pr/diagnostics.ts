import { fixAppCanAuthorize, fixAppCanInstall, fixAppFromEnv, fixPullRequestsEnabled, githubAppJwt, type FixAppEnv } from "@/lib/fix-pr/github-app";

/**
 * Owner-only answer to "why is Fix PR still off?". Names each requirement and whether it holds, never a value:
 * no key, secret or length is shown, so the result is safe to render on the password-protected dashboard.
 */
export type FixCheck = { label: string; ok: boolean; fix: string };

export function fixConfigChecks(app: FixAppEnv | null): FixCheck[] {
  const a = app ?? { appId: "", privateKey: "", clientId: "", clientSecret: "", slug: "", webhookSecret: "" };
  return [
    { label: "GITHUB_FIX_APP_ID is the numeric App ID", ok: /^\d{1,12}$/.test(a.appId), fix: "Copy App ID from the app's General page (a number, not the Client ID)." },
    { label: "GITHUB_FIX_APP_SLUG is set", ok: /^[a-z0-9-]{1,100}$/.test(a.slug), fix: "The last part of github.com/apps/<slug>, lower case." },
    { label: "GITHUB_FIX_APP_PRIVATE_KEY is a PEM key", ok: a.privateKey.includes("BEGIN") && a.privateKey.includes("PRIVATE KEY"), fix: "Paste the whole .pem file, including the -----BEGIN RSA PRIVATE KEY----- and -----END----- lines." },
    { label: "GITHUB_FIX_WEBHOOK_SECRET is at least 16 characters", ok: a.webhookSecret.length >= 16, fix: "Generate a long random secret, set it on the app's webhook and in Vercel (the same value in both)." },
    { label: "GITHUB_FIX_APP_CLIENT_ID looks like a client id", ok: /^[A-Za-z0-9._-]{5,100}$/.test(a.clientId), fix: "Copy Client ID from the app's General page." },
    { label: "GITHUB_FIX_APP_CLIENT_SECRET is at least 20 characters", ok: a.clientSecret.length >= 20, fix: "Generate a new client secret on the app's General page and paste it in full." },
  ];
}

/** Asks GitHub who the private key belongs to. Only the outcome and the app slug GitHub returns are reported. */
export async function fixAppIdentity(app: FixAppEnv | null, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  if (!app || !fixAppCanInstall(app)) return { ok: false, detail: "Skipped: the app id, slug and private key are not all valid yet." };
  let jwt: string;
  try { jwt = githubAppJwt(app.appId, app.privateKey); } catch { return { ok: false, detail: "The private key could not sign a GitHub token. Paste the .pem file again." }; }
  try {
    const response = await fetcher("https://api.github.com/app", { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": "DeployDoctor", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { ok: false, detail: `GitHub refused the key (${response.status}). The private key does not belong to App ID ${app.appId}, or it was revoked.` };
    const body = await response.json() as { slug?: string; id?: number };
    if (String(body.id) !== app.appId) return { ok: false, detail: `GitHub says this key belongs to another app (${body.slug ?? "unknown"}).` };
    if (body.slug !== app.slug) return { ok: false, detail: `The key works, but GitHub's slug is "${body.slug}" while GITHUB_FIX_APP_SLUG says "${app.slug}".` };
    return { ok: true, detail: `GitHub confirms the key belongs to ${body.slug}.` };
  } catch { return { ok: false, detail: "GitHub did not answer. Reload the page to try again." }; }
}

export async function fixDiagnostics() {
  const app = fixAppFromEnv();
  return { enabled: fixPullRequestsEnabled(app), canAuthorize: fixAppCanAuthorize(app), checks: fixConfigChecks(app), identity: await fixAppIdentity(app) };
}
