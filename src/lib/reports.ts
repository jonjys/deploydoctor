import "server-only";
import { cache } from "react";
import type { ReportResults, StoredReport } from "@/types/report";
import { customerSession } from "@/lib/access";
import { db, query, rpc } from "@/lib/db";

export async function saveReport(repoUrl: string, results: ReportResults, customerId?: string, isPrivate = false): Promise<StoredReport> {
  if (isPrivate && !customerId) throw new Error("Private reports need an owner.");
  const report: StoredReport = { id: crypto.randomUUID(), repo_url: repoUrl, results, created_at: new Date().toISOString() };
  await rpc("save_v2_report", { p_report: report, p_private: isPrivate, p_customer_id: customerId ?? null });
  return { ...report, is_private: isPrivate };
}

export const getReport = cache(async (id: string): Promise<StoredReport | null> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const select = "id,repo_url,results,created_at";
  const publicRows = await db<StoredReport[]>(query("reports", { id: `eq.${id}`, select, limit: "1" }));
  if (publicRows[0]) return publicRows[0];
  const customer = await customerSession();
  if (!customer) return null;
  const privateRows = await db<StoredReport[]>(query("private_reports", {
    id: `eq.${id}`, stripe_customer_id: `eq.${customer.customerId}`, select, limit: "1",
  }));
  return privateRows[0] ? { ...privateRows[0], is_private: true } : null;
});
