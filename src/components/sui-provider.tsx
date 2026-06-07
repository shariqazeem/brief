"use client";

import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ZkLoginProvider } from "@/lib/zklogin/state";

import "@mysten/dapp-kit/dist/index.css";

const networks = {
  testnet: { network: "testnet" as const, url: getJsonRpcFullnodeUrl("testnet") },
  mainnet: { network: "mainnet" as const, url: getJsonRpcFullnodeUrl("mainnet") },
};

// Trim because Vercel's env values can ship with trailing whitespace —
// a "testnet\n" value would miss the networks lookup and the SDK would
// throw inside SuiClientProvider.
const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet")
  .trim() as "testnet" | "mainnet";

export function SuiProvider({ children }: { children: React.ReactNode }) {
  // QueryClient must be created per-client-mount so it isn't shared across
  // server-side renders. useState with an initializer is the canonical
  // App Router pattern.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Sui object reads are cheap; aggressive staleTime keeps the UI
            // snappy without crushing the RPC.
            staleTime: 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork={DEFAULT_NETWORK}>
        <WalletProvider autoConnect>
          <ZkLoginProvider>{children}</ZkLoginProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
