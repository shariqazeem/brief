import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import dynamicImport from "next/dynamic";
import "./globals.css";

// dApp Kit's SuiClientProvider + WalletProvider touch `window`/
// `localStorage` during construction (auto-reconnect logic). SSR on
// Vercel was throwing "Cannot read properties of undefined (reading
// 'network')" from inside the dApp Kit constructor chain. Dynamic-
// loading the provider with ssr: false makes the whole tree client-
// only — the body still renders SSR'd HTML for the page meta, but the
// dApp-Kit-dependent React tree mounts in the browser.
const SuiProvider = dynamicImport(
  () => import("@/components/sui-provider").then((m) => m.SuiProvider),
  { ssr: false },
);

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
