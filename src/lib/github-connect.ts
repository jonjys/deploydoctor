import "server-only";
import { cookies } from "next/headers";
import { db, query } from "@/lib/db";
import { signingSecret, type CustomerSession } from "@/lib/session-token";
import { openConnection, openGitHub, parseAppConfig, sealGitHub, type GitHubAppConfig } from "@/lib/github-connect-crypto";
import { z } from "zod";

export const GH_COOKIE = "dd_github";
export const GH_FLOW = "dd_github_flow";
export const GH_SETUP = "dd_github_setup";
export const GH_INSTALL = "dd_github_install";
export const githubCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
const storedConfig = z.object({ clientId: z.string(), clientSecret: z.string(), slug: z.string() });
export async function githubApp(): Promise<GitHubAppConfig | null> {
  const { GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_CLIENT_SECRET: clientSecret, GITHUB_APP_SLUG: slug } = process.env;
  try {
    if (clientId && clientSecret && slug) return parseAppConfig({ clientId, clientSecret, slug });
    const rows = await db<{ ciphertext: string }[]>(query("github_app_settings", { id: "eq.primary", select: "ciphertext", limit: "1" }));
    const config = openGitHub(rows[0]?.ciphertext, "app-config", signingSecret(), storedConfig);
    return config ? parseAppConfig(config) : null;
  } catch { return null; }
}
export async function saveGitHubApp(config: GitHubAppConfig) {
  // Insert only: a second setup cannot overwrite a working production integration.
  await db("github_app_settings", { method: "POST", body: JSON.stringify({ id: "primary", ciphertext: sealGitHub(parseAppConfig(config), "app-config", signingSecret()) }) });
}
export async function githubConnection(customer: CustomerSession | null) {
  if (!customer) return null;
  return openConnection((await cookies()).get(GH_COOKIE)?.value, customer.customerId, signingSecret());
}
export async function githubJson(path: string, token: string) {
  // All callers supply fixed paths; no external fetch URL comes from browser input.
  const response = await fetch("https://api.github.com" + path, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("GitHub connection request failed.");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("GitHub response too large.");
  return JSON.parse(text);
}
