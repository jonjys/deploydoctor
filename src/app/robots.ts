import type { MetadataRoute } from "next";
import { robotsPolicy } from "@/lib/indexing";
import { CANONICAL_ORIGIN } from "@/lib/seo";

// Production allows crawling and points at the sitemap. /api stays disallowed.
// Private reports, account, checkout and similar pages send their own noindex meta tag;
// they stay reachable so link previews and Google can see that tag.
// Preview deployments disallow the whole host. The root layout and X-Robots-Tag repeat noindex there.
export default function robots(): MetadataRoute.Robots {
  return robotsPolicy(CANONICAL_ORIGIN);
}
