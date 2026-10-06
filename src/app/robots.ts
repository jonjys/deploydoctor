import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Accounts, checkout, restore and the API are never for search engines; the home page and pricing are.
// Reports stay crawlable here on purpose: link previews on X follow robots.txt, and the report page
// carries robots noindex in its own metadata, which is what keeps it out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pricing", "/guides", "/ci", "/ai-plugin"], disallow: ["/account", "/checkout", "/restore", "/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
