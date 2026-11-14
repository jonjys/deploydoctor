import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { LangProvider } from "@/components/lang";
import { getT } from "@/lib/lang";
import { siteRobots } from "@/lib/indexing";
import { CANONICAL_ORIGIN, SHARE_IMAGE, canonicalUrl } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const title = t("meta.title");
  const description = t("meta.desc");
  // Link previews on X, Threads, Slack etc. read these; without them a shared
  // link unfurls as bare text.
  return {
    metadataBase: new URL(CANONICAL_ORIGIN),
    title,
    description,
    applicationName: "DeployDoctor",
    icons: { apple: "/favicon.ico" },
    openGraph: { type: "website", siteName: "DeployDoctor", url: canonicalUrl("/"), title, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE.url] },
    // Production is indexable. Preview deployments (VERCEL_ENV !== "production") are noindex.
    // A page that sets its own robots replaces this, which is how private pages stay noindex.
    robots: siteRobots(),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang } = await getT();
  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><LangProvider lang={lang}>{children}</LangProvider><Script src="/_vercel/insights/script.js" strategy="afterInteractive" /></body>
    </html>
  );
}
