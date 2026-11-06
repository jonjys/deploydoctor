import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { guides } from "@/lib/guides";
import { errorPages } from "@/lib/error-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/site-check`, lastModified: "2026-11-06", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/leak-check`, lastModified: "2026-11-05", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/launch-manual`, lastModified: "2026-11-04", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/deploy-handoff`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platforms`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/launch-readiness`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/webhook-replay-lab`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/stats`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/ai-plugin`, lastModified: "2026-10-04", changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/guides`, lastModified: "2026-10-21", changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/diagnose`, lastModified: "2026-10-11", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/fix`, lastModified: "2026-11-03", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/rescue`, lastModified: "2026-11-03", changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/ci`, lastModified: "2026-10-06", changeFrequency: "monthly", priority: 0.8 },
    ...guides.map((guide) => ({ url: `${SITE_URL}/guides/${guide.slug}`, lastModified: guide.updated, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/errors`, lastModified: "2026-10-28", changeFrequency: "monthly", priority: 0.8 },
    ...errorPages.map((page) => ({ url: `${SITE_URL}/errors/${page.slug}`, lastModified: page.updated, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
