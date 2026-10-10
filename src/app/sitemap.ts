import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { guides } from "@/lib/guides";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/ai-plugin`, lastModified: "2026-10-04", changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/guides`, lastModified: "2026-10-05", changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/diagnose`, lastModified: "2026-10-11", changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/ci`, lastModified: "2026-10-06", changeFrequency: "monthly", priority: 0.8 },
    ...guides.map((guide) => ({ url: `${SITE_URL}/guides/${guide.slug}`, lastModified: guide.updated, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
