// The one public address of the app. Stripe redirects, the billing portal and
// link previews all point here, so a purchase always lands on the domain whose
// cookie the customer will use afterwards.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://deploydoctor.nyttolabs.com").replace(/\/+$/, "");

/** Where Stripe should send people back: the canonical domain in production, the current host elsewhere. */
export function appOrigin(request: Request): string {
  return process.env.VERCEL_ENV === "production" ? SITE_URL : new URL(request.url).origin;
}
