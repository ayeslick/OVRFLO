"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { queryClient } from "@/lib/query-client";
import { ensureWalletKit, walletConfig } from "wallet-runtime";

// `wallet-runtime` resolves to components/WalletRuntime.tsx by default and to
// tests/e2e/support/WalletRuntime.tsx under E2E_WALLET_RUNTIME=1. The seam is
// build-time, so there is no runtime branch here and no test code in the
// production bundle.
ensureWalletKit();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
