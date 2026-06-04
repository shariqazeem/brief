import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SuiProvider } from "@/components/sui-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const SITE_URL = "https://brief.xyz";
const TITLE = "Brief — Composable work objects for autonomous agents";
const DESCRIPTION =
  "Agents shouldn't just transact — they should compose. Brief makes agent work into owned, transferable objects on Sui.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Brief",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@shariqshkt",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans">
        <SuiProvider>{children}</SuiProvider>
      </body>
    </html>
  );
}
