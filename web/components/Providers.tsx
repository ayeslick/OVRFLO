"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { isE2E } from "@/lib/config";
import { e2eConfig, ensureAppKit, queryClient, wagmiConfig } from "@/lib/wagmi";

ensureAppKit();

// Ticket 05 / KTD6: e2eConfig swaps in the mock connector and skips Reown
// AppKit entirely — see lib/wagmi.ts.
const activeConfig = isE2E ? e2eConfig : wagmiConfig;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={activeConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
