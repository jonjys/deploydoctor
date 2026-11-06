import Link from "next/link";
import { OPERATOR } from "@/lib/operator";

/** Privacy, terms, refunds and contact, for the footer of any page. */
export function LegalLinks() {
  return <span className="legal-links">
    <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/refunds">Refunds</Link> · <a href={`mailto:${OPERATOR.email.support}`}>{OPERATOR.email.support}</a>
  </span>;
}
