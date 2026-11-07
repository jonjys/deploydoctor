import type { LeakReport } from "@/lib/bundle-leaks-copy";

/** Types for the live site check, safe to import from client components. The logic is in site-check.ts. */

export type LegalKey = "privacy" | "terms" | "returns" | "contact";
/** `where` is "homepage" for a link on the page, a path such as "/policies/privacy-policy" when found by probing, or null. */
export type LegalFinding = { found: boolean; where: string | null };
export type VatFinding = { countryCode: string; vatNumber: string; verdict: "valid" | "invalid" | "unknown"; name: string | null };
export type AiFinding = {
  /** "error" when robots.txt answered 5xx or not at all: then nothing about crawlers is claimed. */
  robotsTxt: "found" | "missing" | "error";
  /** Googlebot may not fetch the homepage or a typical page. */
  googleBlocked: boolean;
  /** Crawlers that fetch pages for AI search answers and assistant browsing (OAI-SearchBot, Claude-SearchBot, PerplexityBot, ...). */
  blockedBots: string[];
  /** Training-only crawlers that are blocked (GPTBot, ClaudeBot, Google-Extended, CCBot): an opt-out, not a search problem. */
  trainingOptOut: string[];
  /** schema.org types declared in JSON-LD or microdata. */
  schemaTypes: string[];
};

export type SiteArea = "keys" | "trust" | "vat" | "ai";
export type SiteStatus = "fail" | "warn" | "pass" | "info";
export type SiteFinding = { id: string; area: SiteArea; status: SiteStatus; title: string; detail: string; fix?: string };

export type SiteCheckReport = {
  url: string;
  host: string;
  leaks: LeakReport;
  legal: Record<LegalKey, LegalFinding>;
  /** How far the search for pages missing from the homepage got: "soft-404" when the site answers 200 for made-up addresses (nothing can be proven), "timed-out" when the time budget ran out. */
  legalSearch: "complete" | "soft-404" | "timed-out";
  /** A checkout, cart, pricing or buy link, or a live Stripe publishable key: returns policy expected. */
  sellsOnline: boolean;
  vat: VatFinding | null;
  ai: AiFinding;
  findings: SiteFinding[];
  summary: { fail: number; warn: number; pass: number };
};

export const AREA_NAMES: Record<SiteArea, string> = {
  keys: "Leaked keys",
  trust: "Trust and EU rules",
  vat: "VAT number",
  ai: "AI search",
};

export const LEGAL_COPY: Record<LegalKey, { name: string; fix: string }> = {
  privacy: { name: "Privacy policy", fix: "Publish a privacy policy and link it from the footer of every page. The GDPR (articles 13 and 14) requires you to tell people how you use their personal data, analytics and contact forms included, and a linked policy is how sites do that." },
  terms: { name: "Terms of sale", fix: "Publish your terms (köpvillkor, AGB, CGV) and link them from the footer, so buyers can read them before they pay." },
  returns: { name: "Returns and refunds", fix: "EU consumers have a 14-day right of withdrawal on most online purchases. Publish how to return an item and who pays return shipping, and link it from the footer." },
  contact: { name: "Contact details", fix: "Show your company name, geographic address and an email address where every page can reach them, usually the footer. The EU E-Commerce Directive (2000/31/EC, article 5) requires all three for an online business, and buyers look for them before paying." },
};
