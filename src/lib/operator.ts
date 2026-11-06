/**
 * Who operates DeployDoctor, as Nytto Labs states it on its other products (Vatidence, Nytto Checkout).
 * Deliberately hard-coded. Public identity only: no personal identity number, VAT ID or residential address.
 */
export const OPERATOR = {
  name: "Nytto Labs",
  url: "https://nyttolabs.com",
  country: "Sweden",
  legalForm: "Swedish sole trader",
  taxStatus: "Approved for F-tax. VAT-registered.",
  email: { support: "support@nyttolabs.com", privacy: "privacy@nyttolabs.com" },
} as const;

/** "Nytto Labs, Sweden. Swedish sole trader. Approved for F-tax. VAT-registered." */
export const OPERATOR_LINE = `${OPERATOR.name}, ${OPERATOR.country}. ${OPERATOR.legalForm}. ${OPERATOR.taxStatus}`;

/** Date the privacy policy, terms and refund policy were last changed. */
export const LEGAL_UPDATED = "6 November 2026";
