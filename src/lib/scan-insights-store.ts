import "server-only";
import { unstable_cache } from "next/cache";
import { rpc } from "@/lib/db";
import type { ScanInsights } from "@/lib/scan-insights";
const cached = unstable_cache(() => rpc<ScanInsights>("public_scan_insights", {}), ["public-scan-insights-v1"], { revalidate: 60 });
export async function scanInsights(): Promise<ScanInsights | null> { try { return await cached(); } catch { return null; } }
