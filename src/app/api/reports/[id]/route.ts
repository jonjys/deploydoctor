import { db, query } from "@/lib/db";
import { requestCustomer } from "@/lib/access";
import { getReport } from "@/lib/reports";
import { reportJson } from "@/lib/report-json";
import { langFromRequest, t } from "@/lib/i18n";
import type { StoredReport } from "@/types/report";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A saved report as JSON. Public reports are open to anyone who has the link, exactly like the page.
 * Private reports need the owner's browser cookie or the owner's API token.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const lang = langFromRequest(request);
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: t(lang, "err.reportNotFound") }, { status: 404 });
  const { customer, viaToken, invalidToken } = await requestCustomer(request);
  if (invalidToken) return Response.json({ error: t(lang, "err.badToken") }, { status: 401 });
  let report: StoredReport | null;
  if (viaToken && customer) {
    report = await getReport(id).catch(() => null);
    if (!report) {
      const rows = await db<StoredReport[]>(query("private_reports", {
        id: `eq.${id}`, stripe_customer_id: `eq.${customer.customerId}`, select: "id,repo_url,results,created_at", limit: "1",
      }));
      report = rows[0] ? { ...rows[0], is_private: true } : null;
    }
  } else {
    report = await getReport(id);
  }
  if (!report) return Response.json({ error: t(lang, "err.reportNotFound") }, { status: 404 });
  return Response.json(reportJson(report), { headers: { "Cache-Control": report.is_private ? "private, no-store" : "public, max-age=60" } });
}
