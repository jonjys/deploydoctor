import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

/**
 * Free GitHub Action scans for public repositories.
 *
 * The Action asks GitHub for an OIDC token (workflow permission `id-token: write`) with our site as
 * audience and sends it instead of an API token. GitHub signs it and names the repository the
 * workflow runs in, so a scan can only be billed to the free quota of that repository, and only
 * when GitHub says the repository is public. Nothing is stored and no account is needed.
 */
export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_HEADER = "x-github-oidc-token";

export type GitHubOidcClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  repository: string;
  repository_visibility?: string;
  [claim: string]: unknown;
};

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; fetchedAt: number } | undefined;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function githubKeys(fetchJwks: () => Promise<{ keys: Jwk[] }>, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const { keys } = await fetchJwks();
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function defaultFetchJwks(): Promise<{ keys: Jwk[] }> {
  const response = await fetch(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`GitHub JWKS returned ${response.status}`);
  return response.json() as Promise<{ keys: Jwk[] }>;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Verifies a GitHub Actions OIDC token and returns its claims, or null when it is not a valid,
 * current token for `audience`. Signature (RS256 against GitHub's published keys), issuer,
 * audience, expiry and not-before are all checked.
 */
export async function verifyGitHubOidc(
  token: string | null | undefined,
  audience: string,
  options: { fetchJwks?: () => Promise<{ keys: Jwk[] }>; now?: number } = {},
): Promise<GitHubOidcClaims | null> {
  if (!token || token.length > 8000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: GitHubOidcClaims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]) as GitHubOidcClaims;
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const fetchJwks = options.fetchJwks ?? defaultFetchJwks;
  let keys = await githubKeys(fetchJwks).catch(() => [] as Jwk[]);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    // GitHub rotates keys; refresh once before giving up.
    keys = await githubKeys(fetchJwks, true).catch(() => [] as Jwk[]);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) return null;

  let valid = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    valid = createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(key, Buffer.from(parts[2], "base64url"));
  } catch {
    return null;
  }
  if (!valid) return null;

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== GITHUB_OIDC_ISSUER) return null;
  if (!audiences.includes(audience)) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - 30) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) return null;
  if (typeof claims.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(claims.repository)) return null;
  return claims;
}

/** Test hook: forget cached keys. */
export function resetGitHubKeyCache() {
  jwksCache = undefined;
}
