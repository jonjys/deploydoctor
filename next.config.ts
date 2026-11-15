import type { NextConfig } from "next";

import { consolidatedErrors } from "./src/lib/seo-routes";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/partner", destination: "/partners", permanent: false }, ...Object.entries(consolidatedErrors).map(([error, guide]) => ({ source: `/errors/${error}`, destination: `/guides/${guide}`, permanent: true }))];
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
    }
    return rules;
  },
};

export default nextConfig;
