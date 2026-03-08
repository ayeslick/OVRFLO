"use client";

import { type ReactNode, useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type State } from "wagmi";
import { wagmiAdapter, wagmiConfig } from "./wagmi-config";
<<<<<<< HEAD
import { resolvedAppKitNetwork } from "./chain-config";
=======
import { PUBLIC_ENV_REFERENCE } from "./launch-config";
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)

export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
      })
  );

  const appKitInit = useRef(false);
  useEffect(() => {
    if (appKitInit.current) return;
    const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
    if (!projectId) {
      console.warn(
        `${PUBLIC_ENV_REFERENCE.reownProjectId} missing — wallet modal disabled`
      );
      return;
    }
    appKitInit.current = true;
    import("@reown/appkit/react").then(({ createAppKit }) => {
      createAppKit({
        adapters: [wagmiAdapter],
        projectId,
        networks: [resolvedAppKitNetwork],
        defaultNetwork: resolvedAppKitNetwork,
        metadata: {
          name: "OVRFLO",
          description: "Pendle PT stream management",
          url: "https://overflow.finance",
          icons: [],
        },
      });
    });
  }, []);

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
