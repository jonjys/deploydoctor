import { scanInsights } from "@/lib/scan-insights-store";
import { ScanActivity } from "@/components/scan-activity";
export async function ScanActivitySection() { return <ScanActivity initial={await scanInsights()} />; }
