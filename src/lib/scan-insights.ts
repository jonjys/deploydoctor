import type { CheckId } from "@/types/report";
import type { Lang } from "@/lib/i18n";
export type ScanInsights = {
  generatedAt: string; windowDays: number; scanLimit: number; scans: number; repositories: number;
  categories: { id: CheckId; red: number; yellow: number; checked: number }[];
  days: { day: string; count: number }[]; activity: { at: string }[];
};
const labels: Record<CheckId, [string, string]> = {
  "next-entry": ["Next.js entrypoint", "Next.js-startpunkt"], imports: ["Import paths", "Importsökvägar"],
  "server-libs": ["Server / Edge compatibility", "Server / Edge-kompatibilitet"], env: ["Environment variables", "Miljövariabler"],
  supabase: ["Supabase", "Supabase"], prisma: ["Prisma / database", "Prisma / databas"],
  "build-config": ["Build configuration", "Byggkonfiguration"], secrets: ["Exposed secrets", "Exponerade hemligheter"], dependencies: ["Dependencies", "Beroenden"],
};
export function insightLabel(id: CheckId, lang: Lang) { return labels[id]?.[lang === "sv" ? 1 : 0] ?? id; }
export function insightPercent(count: number, checked: number) { return checked > 0 ? Math.round(100 * count / checked) : 0; }
