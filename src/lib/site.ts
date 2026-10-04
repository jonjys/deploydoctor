// The one public address of the app. Stripe redirects, the billing portal and
// link previews all point here, so a purchase always lands on the domain whose
// cookie the customer will use afterwards.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://deploydoctor.nyttolabs.com").replace(/\/+$/, "");

/** Saved public reports linked from the home page so visitors see a result before they paste their own repo. */
export const EXAMPLE_REPORTS = [
  { id: "4e515536-d2b3-474f-884e-b4498baa878f", key: "home.example.broken", tone: "red" },
  { id: "000fd3a4-4fa8-4e01-93d7-9dc2b29d6c67", key: "home.example.env", tone: "red" },
  { id: "c90b4327-500c-4a40-8019-a77df7773ef5", key: "home.example.clean", tone: "green" },
] as const;

/** Where Stripe should send people back: the canonical domain in production, the current host elsewhere. */
export function appOrigin(request: Request): string {
  return process.env.VERCEL_ENV === "production" ? SITE_URL : new URL(request.url).origin;
}
