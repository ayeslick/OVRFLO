import { vi } from "vitest";
import { readFailure, unavailableOutcome } from "@/lib/read-outcome";
import { ACCOUNT, LENDING, MARKET, NOW, TOKEN, VAULT, mockBookOutcome } from "./fixtures";
import { fx } from "./watch-fx";

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: fx.connected ? "connected" : "disconnected",
    addresses: fx.connected ? [ACCOUNT] : undefined,
    chainId: 1,
  }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
  useBlock: () => ({ data: { timestamp: NOW } }),
  useSwitchChain: () => ({
    switchChain: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: vi.fn() }),
}));

vi.mock("wallet-runtime", () => ({
  WalletButton: () => <button type="button">CONNECT WALLET</button>,
  ensureWalletKit: () => undefined,
  walletConfig: {},
}));

vi.mock("@/hooks/useClock", () => ({
  useClockHydrationSafe: () => ({ localNow: NOW, skew: 0n, adjustedNow: NOW }),
  useClock: () => ({ localNow: NOW, skew: 0n, adjustedNow: NOW }),
}));

vi.mock("@/hooks/useOvrflos", () => ({
  useOvrflos: () => ({
    status: "ready" as const,
    bootstrap: {
      status: "ready" as const,
      factory: VAULT,
      stream: LENDING,
      vaults: [],
      blockNumber: 1n,
    },
    vaults: [],
    stream: LENDING,
    isLoading: false,
    error: null,
    tooLarge: false,
  }),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: [
      {
        vault: VAULT,
        treasury: VAULT,
        underlying: TOKEN,
        ovrfloToken: TOKEN,
        reserve: TOKEN,
        lending: LENDING,
        retiredLendings: [],
        market: MARKET,
        twapDurationFixed: 900,
        feeBps: 50,
        expiryCached: NOW + 150n * 86_400n,
        ptToken: TOKEN,
        oracle: TOKEN,
      },
    ],
    status: "ready",
    isLoading: false,
    error: null,
    tooLarge: false,
  }),
}));

vi.mock("@/hooks/useMarketSymbols", () => ({
  useMarketSymbols: () => ({ [TOKEN.toLowerCase()]: "ovrfloTEST" }),
  symbolFor: () => "ovrfloTEST",
}));

vi.mock("@/hooks/useLenderBook", () => ({
  useLenderBook: () => mockBookOutcome(fx.lenderStatus, { positions: fx.positions }),
}));

vi.mock("@/hooks/useBorrowerBook", () => ({
  useBorrowerBook: () => mockBookOutcome(fx.borrowerStatus, { loans: fx.loans }),
}));

vi.mock("@/hooks/useStreams", () => ({
  useStreams: () => ({
    ...mockBookOutcome(
      fx.streamStatus,
      { streams: fx.streams },
      {},
      "could-not-ask",
    ),
    advancePin: async () => undefined,
  }),
}));

vi.mock("@/hooks/useUsdPrice", () => ({
  useUsdPrice: () => unavailableOutcome([readFailure("useUsdPrice", "transport", "usd down")]),
}));

vi.mock("@/hooks/useFreshness", () => ({
  useFreshness: () => ({
    freshness: { kind: fx.freshnessKind, asOf: NOW },
    signingAllowed: fx.signingAllowed,
  }),
  sourceFromOutcome: () => ({ status: "success" }),
}));

vi.mock("@/components/watch/useLoanStreams", () => ({
  useLoanStreams: () => fx.loanStreams,
}));
