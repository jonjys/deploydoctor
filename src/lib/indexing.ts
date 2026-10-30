import type { Metadata, MetadataRoute } from "next";

/**
 * Search engines should index the public production site only.
 * Vercel sets VERCEL_ENV to "production" on the production deployment and to
 * "preview" or "development" everywhere else. An unset value is not production.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Root metadata robots. Page-level robots replace this for private surfaces. */
export function siteRobots(): Metadata["robots"] {
  return isProductionDeployment()
    ? { index: true, follow: true }
    : { index: false, follow: false };
}

export const privateNoindex = { index: false, follow: false } as const;

/** robots.txt: production may be crawled and points at the sitemap. Previews may not. */
export function robotsPolicy(siteUrl: string): MetadataRoute.Robots {
  return {
    rules: isProductionDeployment()
      ? [{ userAgent: "*", allow: "/", disallow: ["/api/"] }]
      : [{ userAgent: "*", disallow: "/" }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
