import { scanInsights } from "@/lib/scan-insights-store";
export async function GET() {
  const data = await scanInsights();
  return data ? Response.json(data, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } })
    : Response.json({ error: "Statistics are unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
