import { githubJson } from "@/lib/github-connect";
import { acceptFreshInstallation, githubAppJwt } from "@/lib/fix-pr/github-app";

/** Confirms the installation with the app's own key. Used when the OAuth client secret is not set. */
export async function confirmedInstallation(installationId: number, app: { appId: string; privateKey: string }, now = Date.now()): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${githubAppJwt(app.appId, app.privateKey, Math.floor(now / 1000))}`,
        Accept: "application/vnd.github+json", "User-Agent": "DeployDoctor", "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return acceptFreshInstallation(await response.json(), installationId, app.appId, now);
  } catch { return null; }
}

/** The claimed installation, only when GitHub lists it among this user's installations of this Fix app. */
export async function verifiedInstallation(userToken: string, claimed: number, app: { appId: string; slug: string }): Promise<number | null> {
  try {
    const listed = await githubJson("/user/installations?per_page=100", userToken) as { installations?: Array<{ id?: number; app_id?: number; app_slug?: string }> };
    const match = (listed.installations ?? []).find(item => item.id === claimed && (String(item.app_id) === app.appId || item.app_slug === app.slug));
    return match ? claimed : null;
  } catch { return null; }
}
