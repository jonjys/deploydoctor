import "server-only";

import { cache } from "react";
import type { ReportResults, StoredReport } from "@/types/report";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured; set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  return { url: url.replace(/\/$/, ""), secretKey };
}

async function supabaseRequest(pathname: string, init?: RequestInit): Promise<Response> {
  const { url, secretKey } = supabaseConfig();
  return fetch(`${url}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      // Supabase sb_secret keys are API keys, not JWTs. Send them only via apikey.
      apikey: secretKey,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function saveReport(repoUrl: string, results: ReportResults): Promise<StoredReport> {
  const report: StoredReport = {
    id: crypto.randomUUID(),
    repo_url: repoUrl,
    results,
    created_at: new Date().toISOString(),
  };
  const response = await supabaseRequest("reports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("Supabase report insert failed:", response.status, message.slice(0, 300));
    throw new Error("The report was generated but could not be saved.");
  }

  const rows = (await response.json()) as StoredReport[];
  return rows[0] ?? report;
}

export const getReport = cache(async (id: string): Promise<StoredReport | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const query = new URLSearchParams({
    id: `eq.${id}`,
    select: "id,repo_url,results,created_at",
    limit: "1",
  });
  const response = await supabaseRequest(`reports?${query.toString()}`);

  if (!response.ok) {
    const message = await response.text();
    console.error("Supabase report read failed:", response.status, message.slice(0, 300));
    throw new Error("The saved report could not be loaded.");
  }

  const rows = (await response.json()) as StoredReport[];
  return rows[0] ?? null;
});
