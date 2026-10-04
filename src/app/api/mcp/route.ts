import { POST as scan } from "../reports/route";
import { getReport } from "@/lib/reports";
import { handleDeployMcp } from "@/lib/mcp";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleDeployMcp(request, { scan, report: getReport }, SITE_URL);
}
export async function GET() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
export async function DELETE() { return GET(); }
