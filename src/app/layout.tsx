import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LangProvider } from "@/components/lang";
import { getT } from "@/lib/lang";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://deploydoctor-one.vercel.app";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const title = t("meta.title");
  const description = t("meta.desc");
  // Link previews on X, Threads, Slack etc. read these; without them a shared
  // link unfurls as bare text.
  const image = { url: "/og.png", width: 1200, height: 630, alt: title };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: { type: "website", siteName: "DeployDoctor", url: "/", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang } = await getT();
  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><LangProvider lang={lang}>{children}</LangProvider></body>
    </html>
  );
}
