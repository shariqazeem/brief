"use client";

// WalletBoundary — scopes the dapp-kit / zkLogin provider stack to the
// routes that actually need a wallet (workforce, leaderboard).
//
// Previously SuiProvider wrapped {children} in the ROOT layout with
// `ssr: false`, which forced EVERY route — including the marketing
// landing, which touches no wallet code — to bail out of SSR
// (BAILOUT_TO_CLIENT_SIDE_RENDERING) and paint blank until hydration.
// Pulling it out of the root layout lets the landing server-render real
// content (first paint, SEO, no flash) while the app pages keep the
// exact same `ssr: false` provider behavior they had before.

import dynamicImport from "next/dynamic";

// dapp-kit reads browser globals (localStorage for wallet autoconnect)
// at init, so the provider must stay client-only. ssr: false here means
// only the wrapped app subtree is client-rendered — not the whole site.
const SuiProvider = dynamicImport(
  () => import("@/components/sui-provider").then((m) => m.SuiProvider),
  { ssr: false },
);

export function WalletBoundary({ children }: { children: React.ReactNode }) {
  return <SuiProvider>{children}</SuiProvider>;
}
