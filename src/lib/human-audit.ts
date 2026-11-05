/** Live Stripe Payment Link for the manual Vercel deploy audit (€49). Not a scan pass. */
export const HUMAN_AUDIT_PAYMENT_URL = "https://buy.stripe.com/cNi7sKbqh6ASh169j78og2L";

/** Stripe copies this query parameter onto the Checkout Session for the Payment Link. */
export const CLIENT_REFERENCE_PARAM = "client_reference_id";

export const PARTNER_SUPPORT_EMAIL = "support@nyttolabs.com";

/** 2–64 characters. Letters, digits, and hyphens. Stripe allows up to 200; short slugs are easier to match by hand. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePartnerSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function partnerAuditUrl(input: string): string | null {
  const slug = normalizePartnerSlug(input);
  if (slug.length < 2 || !SLUG.test(slug)) return null;
  const url = new URL(HUMAN_AUDIT_PAYMENT_URL);
  url.searchParams.set(CLIENT_REFERENCE_PARAM, slug);
  return url.toString();
}

export type PartnerInquiry = {
  agency: string;
  email: string;
  website?: string;
  slug: string;
};

function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Mailto for a partner signup. Subject is "Partner" plus the agency name. Returns null when a field is unusable. */
export function partnerMailto(inquiry: PartnerInquiry): string | null {
  const agency = oneLine(inquiry.agency);
  const email = oneLine(inquiry.email);
  const website = oneLine(inquiry.website ?? "");
  const slug = normalizePartnerSlug(inquiry.slug);
  const link = partnerAuditUrl(slug);
  if (!agency || agency.length > 120) return null;
  if (!EMAIL.test(email) || email.length > 200) return null;
  if (website.length > 200) return null;
  if (!link) return null;
  const body = [
    `Agency: ${agency}`,
    `Email: ${email}`,
    website ? `Website: ${website}` : null,
    `Slug: ${slug}`,
    `Payment link: ${link}`,
    "",
    "Please confirm this slug before we share the link with clients.",
  ].filter((line): line is string => line !== null).join("\n");
  return `mailto:${PARTNER_SUPPORT_EMAIL}?subject=${encodeURIComponent(`Partner ${agency}`)}&body=${encodeURIComponent(body)}`;
}

export function partnerFallbackMailto(): string {
  return `mailto:${PARTNER_SUPPORT_EMAIL}?subject=${encodeURIComponent("Partner")}`;
}
