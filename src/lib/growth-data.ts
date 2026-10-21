import "server-only";
import { stripeClient } from "@/lib/stripe";

export type TrafficDay = { day: string; visitors: number; pageviews: number };
export type GrowthTraffic = {
  visitors: number; pageviews: number;
  days: TrafficDay[];
  pages: Array<{ path: string; visitors: number; pageviews: number }>;
  events: Array<{ name: string; count: number }>;
};
export type GrowthPayments = {
  paidCheckouts: number;
  gross: Array<{ currency: string; minorUnits: number }>;
  partial: boolean;
};
export type GrowthReport = {
  traffic: GrowthTraffic | null;
  payments: GrowthPayments | null;
  trafficStatus: string | null;
  paymentStatus: string | null;
  started: string;
  ended: string;
};

const PROJECT_ID = "prj_iQhXsyDjJc9HWnwGA6Fz1UdfaHde";
const TEAM_ID = "team_r5F4djJEP3c1KX8a0Jr4VO6o";

export function growthWindow(days: 7 | 30, now = new Date()) {
  const end = new Date(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - days + 1));
  return { start: start.toISOString(), end: end.toISOString(), seconds: Math.floor(start.getTime() / 1000) };
}

type VisitsCount = { data?: { visitors?: number; pageviews?: number } };
type VisitsAggregate = { data?: Array<{ timestamp?: string; requestPath?: string; visitors?: number; pageviews?: number }> };
type EventsAggregate = { data?: Array<{ eventName?: string; events?: number; count?: number }> };

async function vercelQuery<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL("https://api.vercel.com/v1/query/web-analytics/" + path);
  url.searchParams.set("teamId", process.env.GROWTH_VERCEL_TEAM_ID || TEAM_ID);
  url.searchParams.set("projectId", process.env.GROWTH_VERCEL_PROJECT_ID || PROJECT_ID);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const result = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!result.ok) throw new Error("Vercel Web Analytics returned " + result.status);
  return result.json() as Promise<T>;
}

async function loadTraffic(start: string, end: string): Promise<GrowthTraffic> {
  const token = process.env.GROWTH_VERCEL_API_TOKEN;
  if (!token) throw new Error("Set GROWTH_VERCEL_API_TOKEN in Vercel to read Web Analytics.");
  const period = { since: start, until: end };
  const [count, pages, days, events] = await Promise.all([
    vercelQuery<VisitsCount>("visits/count", period, token),
    vercelQuery<VisitsAggregate>("visits/aggregate", { ...period, by: "requestPath", limit: "100" }, token),
    vercelQuery<VisitsAggregate>("visits/aggregate", { ...period, by: "day", limit: "35" }, token),
    vercelQuery<EventsAggregate>("events/aggregate", { ...period, by: "eventName", limit: "40" }, token).catch(() => null),
  ]);
  if (!count.data || typeof count.data.visitors !== "number" || typeof count.data.pageviews !== "number" || !Array.isArray(pages.data) || !Array.isArray(days.data)) {
    throw new Error("Vercel Analytics returned an unexpected result.");
  }
  return {
    visitors: count.data.visitors, pageviews: count.data.pageviews,
    pages: pages.data
      .filter((row) => typeof row.requestPath === "string" && row.requestPath !== "Others")
      .map((row) => ({ path: row.requestPath!, visitors: row.visitors || 0, pageviews: row.pageviews || 0 })),
    days: days.data
      .filter((row) => typeof row.timestamp === "string")
      .map((row) => ({ day: row.timestamp!.slice(0, 10), visitors: row.visitors || 0, pageviews: row.pageviews || 0 })),
    events: Array.isArray(events?.data) ? events.data
      .filter((row) => typeof row.eventName === "string")
      .map((row) => ({ name: row.eventName!, count: row.events ?? row.count ?? 0 })) : [],
  };
}

async function loadPayments(startSeconds: number, endSeconds: number): Promise<GrowthPayments> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  const stripe = stripeClient();
  const currencyTotals = new Map<string, number>();
  let paidCheckouts = 0;
  let cursor: string | undefined;
  let partial = false;
  for (let page = 0; page < 5; page++) {
    const result = await stripe.checkout.sessions.list({
      created: { gte: startSeconds, lte: endSeconds }, limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    for (const checkout of result.data) {
      if (checkout.metadata?.app !== "deploydoctor" || checkout.payment_status !== "paid") continue;
      paidCheckouts++;
      if (typeof checkout.amount_total !== "number" || !checkout.currency) continue;
      const currency = checkout.currency.toUpperCase();
      currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + checkout.amount_total);
    }
    if (!result.has_more) break;
    if (page === 4) { partial = true; break; }
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor) { partial = true; break; }
  }
  return { paidCheckouts, gross: [...currencyTotals].map(([currency, minorUnits]) => ({ currency, minorUnits })), partial };
}

export async function readGrowthReport(days: 7 | 30): Promise<GrowthReport> {
  const period = growthWindow(days);
  const [traffic, payments] = await Promise.allSettled([
    loadTraffic(period.start, period.end),
    loadPayments(period.seconds, Math.floor(new Date(period.end).getTime() / 1000)),
  ]);
  return {
    traffic: traffic.status === "fulfilled" ? traffic.value : null,
    payments: payments.status === "fulfilled" ? payments.value : null,
    trafficStatus: traffic.status === "rejected" ? "Traffic unavailable: check the Vercel Analytics API token and access." : null,
    paymentStatus: payments.status === "rejected" ? "Payments unavailable: check the Stripe connection." : null,
    started: period.start, ended: period.end,
  };
}

export function projectedRevenue(visitors: number, conversionRate: number, priceUsd: number): number {
  return Math.max(0, visitors) * Math.max(0, conversionRate) / 100 * Math.max(0, priceUsd);
}
