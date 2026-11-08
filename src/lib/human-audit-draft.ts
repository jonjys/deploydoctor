/**
 * Unpublished audit Payment Link. Do not import this from a page or client component.
 * The public homepage audit stays on its existing link until a later confirmation.
 */
export const DRAFT_HUMAN_AUDIT_PAYMENT_URL = "https://buy.stripe.com/cNi7sKbqh6ASh169j78og2L";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function draftPartnerAuditUrl(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (slug.length < 2 || !SLUG.test(slug)) return null;
  const url = new URL(DRAFT_HUMAN_AUDIT_PAYMENT_URL);
  url.searchParams.set("client_reference_id", slug);
  return url.toString();
}
