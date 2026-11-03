/** Stripe metadata app id for a paywalled fix pull request. Distinct from scan passes and import patches. */
export const FIX_APP = "deploydoctor_fix";
/** $5, in cents. Same amount as a verified import patch. */
export const FIX_AMOUNT = 500;
export const FIX_CURRENCY = "usd";
/** Launch promo: the first this many delivered fixes skip checkout. */
export const FIX_PROMO_CAP = 50;
export const FIX_PROMO_ID = "launch";

/** Checkout integration label. The suffix is 8 letters, as Stripe expects on current API versions. */
export function fixIntegrationLabel(nonce: string): string {
  const alphabet = "abcdefghij";
  const letters = nonce.slice(0, 8).replace(/[0-9]/g, (digit) => alphabet[Number(digit)] ?? "a").replace(/[^a-z]/g, "a");
  return `${FIX_APP}_checkout_${letters.padEnd(8, "a").slice(0, 8)}`;
}
