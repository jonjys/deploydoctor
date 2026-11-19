import type { MetadataRoute } from "next";
import { robotsPolicy } from "@/lib/indexing";
import { SITE_URL } from "@/lib/site";

// Production allows crawling and points at the sitemap. /api stays disallowed.
// Reports, account, checkout and similar pages send their own noindex meta tag.
// /r/ stays allowed so link previews can still fetch a report.
// Preview deployments disallow the whole host. The root layout and X-Robots-Tag repeat noindex there.
export default function robots(): MetadataRoute.Robots {
  return robotsPolicy(SITE_URL);
}
