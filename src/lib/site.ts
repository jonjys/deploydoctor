// The one public address of the app. Stripe redirects, the billing portal and
// link previews all point here, so a purchase always lands on the domain whose
// cookie the customer will use afterwards.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://deploydoctor.nyttolabs.com").replace(/\/+$/, "");

/** A saved public report with red findings, linked from the home page so visitors see a result before they scan. */
export const EXAMPLE_REPORT_ID = "4e515536-d2b3-474f-884e-b4498baa878f";

/** Where Stripe should send people back: the canonical domain in production, the current host elsewhere. */
export function appOrigin(request: Request): string {
  return process.env.VERCEL_ENV === "production" ? SITE_URL : new URL(request.url).origin;
}
