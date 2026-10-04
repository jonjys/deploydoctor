import type { ScanPlan } from "@/lib/plans";

export function scanCheckoutHref(plan: ScanPlan, reportId?: string, checkId?: string) {
  const params = new URLSearchParams({ plan });
  if (reportId) params.set("report", reportId);
  if (checkId) params.set("check", checkId);
  return `/checkout?${params.toString()}`;
}

export function isStripeCheckoutUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}
