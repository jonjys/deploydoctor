import type { Metadata } from "next";

/** Public production host. Canonicals, the sitemap and social tags use this so another host is not a second copy of the site. */
export const CANONICAL_ORIGIN = "https://deploydoctor.nyttolabs.com";

export const SHARE_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "DeployDoctor: know before you push.",
} as const;

export function canonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/" ? `${CANONICAL_ORIGIN}/` : `${CANONICAL_ORIGIN}${normalized}`;
}

/** Brand a short document title. Leave a title that is already specific and longer than a search result. */
export function documentTitle(title: string): string {
  if (title.includes("DeployDoctor")) return title;
  const branded = `${title} | DeployDoctor`;
  return branded.length <= 60 ? branded : title;
}

type ShareImage = { url: string; width?: number; height?: number; alt?: string };

/** Title, description, canonical, Open Graph and Twitter for one public URL. */
export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  /** Null on routes that generate their own opengraph-image file. */
  image?: ShareImage | null;
  robots?: Metadata["robots"];
  canonical?: boolean;
}): Metadata {
  const url = canonicalUrl(input.path);
  const image = input.image === undefined ? SHARE_IMAGE : input.image;
  return {
    title: input.title,
    description: input.description,
    ...(input.canonical === false ? {} : { alternates: { canonical: url } }),
    openGraph: {
      type: input.type ?? "website",
      siteName: "DeployDoctor",
      url,
      title: input.title,
      description: input.description,
      ...(image ? { images: [{ url: image.url, width: image.width, height: image.height, alt: image.alt ?? input.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      ...(image ? { images: [image.url] } : {}),
    },
    ...(input.robots ? { robots: input.robots } : {}),
  };
}

export const pages = {
  safe: {
    path: "/safe",
    title: "Check your live app for leaked keys | DeployDoctor",
    description: "Paste a live app URL. DeployDoctor looks for secret keys in the JavaScript, open Supabase tables, public .env and .git files, source maps and headers.",
  },
  leak: {
    path: "/leak-check",
    title: "Is an API key in your live JavaScript? | DeployDoctor",
    description: "Paste a live site. DeployDoctor reads the JavaScript visitors download and looks for Stripe, Supabase, OpenAI and Anthropic keys from public env variables.",
  },
  siteCheck: {
    path: "/site-check",
    title: "Live site check: keys, VAT and AI search | DeployDoctor",
    description: "Paste a live site. DeployDoctor looks for secret keys in the JavaScript, privacy, terms, returns and contact pages, a VAT number in VIES, and AI crawler blocks.",
  },
  launch: {
    path: "/launch-manual",
    type: "article" as const,
    title: "Launch manual: localhost to first customer | DeployDoctor",
    description: "Steps after the app works locally: deploy it, set environment variables, switch Stripe live mode, check Supabase RLS, sign-in, legal pages and monitoring.",
  },
  ready: {
    path: "/launch-readiness",
    title: "Deployment checklist before you launch | DeployDoctor",
    description: "Check a GitHub repository for Vercel build, Stripe webhook and production configuration risks before launch. Evidence from the source, plus a next step.",
  },
  webhook: {
    path: "/webhook-replay-lab",
    title: "Stripe webhook review and regression tests | DeployDoctor",
    description: "Review pasted Stripe webhook code with line evidence and download a regression-test scaffold. Explore retries and crash recovery in a free simulation.",
  },
  platforms: {
    path: "/platforms",
    title: "Supported platforms and scan coverage | DeployDoctor",
    description: "Static source and deployment checks for Cloudflare, Netlify, Vercel, Fly.io, Render, Railway legacy configs and Docker, including what stays unverified.",
  },
  handoff: {
    path: "/deploy-handoff",
    title: "What must ship with a merged pull request | DeployDoctor",
    description: "Compare a GitHub pull request and get a commit-pinned checklist: new environment references, migrations, hosting settings, build commands and endpoints.",
  },
  ci: {
    path: "/ci",
    type: "article" as const,
    title: "Scan a pull request before Vercel builds | DeployDoctor",
    description: "A GitHub Action that flags case-sensitive imports, missing env variables, undeclared packages and Edge mistakes on the changed files before Vercel builds.",
  },
  ai: {
    path: "/ai-plugin",
    title: "DeployDoctor MCP plugin — source-backed deployment checks",
    description: "Paste a build log in chat to triage missing modules, npm ERESOLVE and hydration mismatches, with official docs and verification steps. Public repo scans too.",
  },
  guides: {
    path: "/guides",
    title: "Vercel deployment troubleshooting guides | DeployDoctor",
    description: "Practical guides for Next.js, Vite, SvelteKit, pnpm, Supabase, build settings and runtime errors that show up when a project fails on Vercel. Then run a scan.",
  },
  errors: {
    path: "/errors",
    title: "Common Vercel deployment errors and fixes | DeployDoctor",
    description: "One short page per common Vercel error, with the steps from the official Vercel and Next.js documentation and a link straight to that source in the log.",
  },
  privacy: {
    path: "/privacy",
    title: "Privacy policy: storage and deletion | DeployDoctor",
    description: "What DeployDoctor stores, who else receives it, how long reports are kept, and how to email and ask for one to be deleted. Nytto Labs, Sweden. Ask by email.",
  },
  terms: {
    path: "/terms",
    title: "Sale terms for scans, patches and fixes | DeployDoctor",
    description: "What DeployDoctor sells, how scan passes, subscriptions, patches and fix pull requests work, and which outcomes a scan does not promise before you buy a pass.",
  },
  refunds: {
    path: "/refunds",
    title: "Refund policy and withdrawal rights | DeployDoctor",
    description: "When a fix pull request is refunded on its own, how the 14-day withdrawal works, and how to email support and ask for money back on another purchase from us.",
  },
} as const;

export const partnerMeta = {
  en: {
    title: "How an agency partner slug is tracked | DeployDoctor",
    description: "How an agency slug is added to an audit payment link with client_reference_id. Explains the reference. This page does not publish a price. It is not a coupon.",
  },
  sv: {
    title: "Så fungerar en byrås partnerspårning | DeployDoctor",
    description: "Hur en byrås slug läggs till på en granskningslänk med client_reference_id. Förklarar referensen. Sidan publicerar inget pris. Det är ingen rabattkod alls.",
  },
} as const;

export const statsMeta = {
  en: {
    title: "Common findings in public repo scans | DeployDoctor",
    description: "Anonymous statistics from recent public repository scans. See common findings, review warnings and how the numbers are calculated. No private repos are shown.",
  },
  sv: {
    title: "Vanliga fynd i publika repo-skanningar | DeployDoctor",
    description: "Anonym statistik från senaste publika repo-skanningarna. Se vanliga fynd, granskningsvarningar och hur talen räknas. Inga privata repon eller namn visas.",
  },
} as const;

export const notFoundMeta = {
  en: {
    title: "This address is not a page on the DeployDoctor site",
    description: "The link may be incomplete, or the saved report is no longer available. Open the DeployDoctor homepage and use the scan form there. Paste a repository URL.",
  },
  sv: {
    title: "Adressen som du öppnade är ingen sida på DeployDoctor",
    description: "Länken kan vara ofullständig, eller så finns den sparade rapporten inte kvar. Öppna startsidan och använd skanningsformuläret som ligger där. Klistra in repot.",
  },
} as const;

export const scoreDescription = "Latest public scan of this repository: the checked commit and findings. Static checks do not run the code or guarantee a deployment. Rescan after edits.";
