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

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("meta.title"), description: t("meta.desc") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang } = await getT();
  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><LangProvider lang={lang}>{children}</LangProvider></body>
    </html>
  );
}
