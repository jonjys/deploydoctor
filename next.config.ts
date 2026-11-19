import type { NextConfig } from "next";

import { vercelAppHostGuard } from "./src/lib/indexing";
import { consolidatedErrors } from "./src/lib/seo-routes";
import { SITE_URL } from "./src/lib/site";

const nextConfig: NextConfig = {
  async redirects() {
    const pages = [{ source: "/partner", destination: "/partners", permanent: false }, ...Object.entries(consolidatedErrors).map(([error, guide]) => ({ source: `/errors/${error}`, destination: `/guides/${guide}`, permanent: true }))];
    return [...pages, ...vercelAppHostGuard(SITE_URL).redirects];
  },
  async headers() {
    const rules: Awaited<ReturnType<NonNullable<NextConfig["headers"]>>> = [
      // API responses are not documents. noindex here, and robots.txt disallows /api/.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/patch/:path*", headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ] },
    ];
    // Preview and any non-production deploy stay out of Google. Production does not send this header.
    if (process.env.VERCEL_ENV !== "production") {
      rules.unshift({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] });
    } else {
      rules.push(...vercelAppHostGuard(SITE_URL).headers);
    }
    return rules;
  },
};

export default nextConfig;
