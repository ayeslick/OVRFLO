import { QueryClient } from "@tanstack/react-query";

// Separate from lib/wagmi.ts on purpose. That module constructs the Reown
// `WagmiAdapter` at module scope, so anything importing it pulls AppKit and its
// WalletConnect setup into the bundle. `Providers` needs the query client in
// every runtime — including the E2E one, which must not load AppKit at all — so
// the client lives here where both wallet runtimes can reach it without
// dragging the production wallet stack along.
//
// A module-level singleton rather than the `useState(() => new QueryClient())`
// the wagmi docs show: that pattern exists to stop one server process sharing a
// cache across users, and `output: "export"` means there is no server process.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});
