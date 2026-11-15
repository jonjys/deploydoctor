/** Retired references share one maintained guide, one sitemap URL and one social preview. */
export const consolidatedErrors: Record<string, string> = {
  "vercel-missing-environment-variable": "vercel-environment-variable-undefined",
  "vercel-404-not-found-after-deploy": "vercel-404-not-found-ready-deployment",
  "vercel-module-not-found-cant-resolve": "module-not-found-vercel-case-sensitive-imports",
  "vercel-node-version-mismatch": "vercel-node-version-mismatch",
  "vercel-500-internal-server-error": "vercel-function-invocation-failed",
};
export function consolidatedGuide(slug: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(consolidatedErrors, slug) ? consolidatedErrors[slug] : undefined;
}
export function errorPagePath(slug: string): string {
  return consolidatedGuide(slug) ? `/guides/${consolidatedGuide(slug)}` : `/errors/${slug}`;
}
