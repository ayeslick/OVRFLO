import { vi } from "vitest";
import { loadingOutcome, readFailure, readyOutcome, unavailableOutcome } from "@/lib/read-outcome";
import { ACCOUNT, LENDING, MARKET, NOW, TOKEN, VAULT } from "./fixtures";
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
  useOvrflos: () => ({ vaults: [], isLoading: false, error: null, tooLarge: false }),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: [
      {
        vault: VAULT,
        treasury: VAULT,
        underlying: TOKEN,
        ovrfloToken: TOKEN,
        lending: LENDING,
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
  useLenderBook: () => {
    if (fx.lenderStatus === "loading") return loadingOutcome();
    if (fx.lenderStatus === "unavailable") {
      return unavailableOutcome([readFailure("useLenderBook", "transport", "down")]);
    }
    return readyOutcome({ positions: fx.positions });
  },
}));

vi.mock("@/hooks/useBorrowerBook", () => ({
  useBorrowerBook: () => {
    if (fx.borrowerStatus === "loading") return loadingOutcome();
    if (fx.borrowerStatus === "unavailable") {
      return unavailableOutcome([readFailure("useBorrowerBook", "transport", "down")]);
    }
    return readyOutcome({ loans: fx.loans });
  },
}));

vi.mock("@/hooks/useStreams", () => ({
  useStreams: () => {
    const empty = { ids: [] as bigint[] };
    const truth = { candidates: [] as bigint[], streams: fx.streams };
    if (fx.streamStatus === "loading") {
      return { candidates: loadingOutcome(empty), truth: loadingOutcome(truth) };
    }
    if (fx.streamStatus === "unavailable") {
      const failure = [readFailure("useStreams", "transport", "could-not-ask")];
      return {
        candidates: unavailableOutcome(failure),
        truth: unavailableOutcome(failure),
      };
    }
    return { candidates: readyOutcome(empty), truth: readyOutcome(truth) };
  },
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
