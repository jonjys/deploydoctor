import { githubJson } from "@/lib/github-connect";

/** The claimed installation, only when GitHub lists it among this user's installations of this Fix app. */
export async function verifiedInstallation(userToken: string, claimed: number, app: { appId: string; slug: string }): Promise<number | null> {
  try {
    const listed = await githubJson("/user/installations?per_page=100", userToken) as { installations?: Array<{ id?: number; app_id?: number; app_slug?: string }> };
    const match = (listed.installations ?? []).find(item => item.id === claimed && (String(item.app_id) === app.appId || item.app_slug === app.slug));
    return match ? claimed : null;
  } catch { return null; }
}
