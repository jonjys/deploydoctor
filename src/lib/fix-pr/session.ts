import { z } from "zod";

export const FIX_INSTALL_COOKIE = "dd_fix_install";
export const FIX_FLOW_COOKIE = "dd_fix_flow";
export const FIX_TOKEN_COOKIE = "dd_fix_token";
export const fixCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export const fixInstallSchema = z.object({ installationId: z.number().int().positive(), expiresAt: z.number() });
export const fixFlowSchema = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/), verifier: z.string().min(43).max(128), repo: z.string().max(300), expiresAt: z.number(),
  /** The installation GitHub's setup redirect named. Only a claim: the callback checks it against the user's own installations. */
  claimedInstallation: z.number().int().positive().optional(),
});
export const fixTokenSchema = z.object({
  token: z.string().regex(/^ghu_[A-Za-z0-9_]{1,280}$/), login: z.string().max(100), expiresAt: z.number(),
});
