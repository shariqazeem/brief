import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// NOTE: the dApp Kit provider is NO LONGER in the root layout. It lived
// here wrapped in `ssr: false`, which forced EVERY route · including the
// wallet-free marketing landing · to bail out of SSR and paint blank
// until hydration. It now lives in <WalletBoundary> (src/components/
// wallet-boundary.tsx), used only by the routes that need a wallet
// (/workforce, /leaderboard). The landing now server-renders fully.

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
const TITLE = "Brief · Adopt an operator. The chain holds the leash.";
const DESCRIPTION =
  "Adopt an autonomous financial operator on Sui. It manages capital on DeepBook Predict + DeepBook v3 spot, thinks in public, remembers on Walrus · every action gated by a Move OperatorPolicy you can revoke in one tap.";

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
      <body className="font-sans">{children}</body>
    </html>
  );
}
