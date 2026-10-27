import Link from "next/link";
import type { ScanInsights } from "@/lib/scan-insights";
import { insightLabel, insightPercent } from "@/lib/scan-insights";
import type { CheckId } from "@/types/report";
import type { Lang } from "@/lib/i18n";

const help: Partial<Record<CheckId, string>> = {
  env: "/guides/vercel-environment-variable-undefined",
  imports: "/guides/module-not-found-vercel-case-sensitive-imports",
  "next-entry": "/guides/nextjs-works-locally-fails-on-vercel",
  "server-libs": "/guides/edge-runtime-node-module-error-vercel",
  "build-config": "/guides/err-pnpm-outdated-lockfile-vercel",
  dependencies: "/guides/err-pnpm-outdated-lockfile-vercel",
  supabase: "/guides/supabase-42501-permission-denied-new-table",
  prisma: "/guides/prisma-generate-vercel-deploy",
  "production-safety": "/launch-readiness",
};

/** The same anonymous, deduplicated findings in public Stats and private Growth HQ. */
export function FindingStats({ data, lang = "en" }: { data: ScanInsights; lang?: Lang }) {
  const sv = lang === "sv";
  const categories = [...data.categories].sort((a, b) => (b.red + b.yellow) - (a.red + a.yellow) || b.red - a.red);
  return <div className="finding-stats">
    {categories.length === 0 ? <p>{sv ? "Inget underlag ännu." : "No complete public scan data yet."}</p> : categories.map(category => {
      const affected = category.red + category.yellow;
      return <article className="finding-stat" key={category.id}>
        <div><strong>{insightLabel(category.id, lang)}</strong><span>{affected} / {category.checked} {sv ? "kontrollerade repon" : "checked repos"}</span></div>
        <div className="finding-stat-counts"><span>{category.red} {sv ? "röda" : "red"}</span><span>{category.yellow} {sv ? "att granska" : "to review"}</span><strong>{insightPercent(affected, category.checked)}%</strong></div>
        <meter min={0} max={Math.max(1, category.checked)} value={affected} aria-label={`${insightLabel(category.id, lang)}: ${affected} / ${category.checked}`} />
        {affected > 0 && <Link href={help[category.id] ?? "/guides"}>{sv ? "Hjälp med dessa risker" : "Help with these risks"} →</Link>}
      </article>;
    })}
  </div>;
}
