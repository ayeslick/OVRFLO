import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import ActivityPage from "@/app/activity/page";
import { loadingOutcome, readyOutcome } from "@/lib/read-outcome";
import { resetDisclosure } from "@/lib/disclosure";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as Address;

const fx = vi.hoisted(() => ({
  connected: true,
  ovrflosStatus: "ready" as "ready" | "loading" | "unavailable",
  marketsStatus: "ready" as "ready" | "loading" | "unavailable",
  enabled: undefined as boolean | undefined,
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: fx.connected ? "connected" : "disconnected",
    addresses: fx.connected ? [ACCOUNT] : undefined,
    chainId: 1,
  }),
  useBlock: () => ({ data: { number: 10n, timestamp: 1_800_000_000n } }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
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

vi.mock("@/hooks/useOvrflos", () => ({
  useOvrflos: () => ({
    status: fx.ovrflosStatus,
    vaults: [{ vault: VAULT, retiredLendings: [] }],
    stream: LENDING,
    isLoading: fx.ovrflosStatus === "loading",
    tooLarge: false,
    error: fx.ovrflosStatus === "unavailable" ? new Error("factory down") : null,
  }),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: [],
    status: fx.marketsStatus,
    isLoading: fx.marketsStatus === "loading",
    error: fx.marketsStatus === "unavailable" ? new Error("markets down") : null,
    tooLarge: false,
  }),
}));

vi.mock("@/hooks/usePortfolioActivity", () => ({
  usePortfolioActivity: (input: { enabled?: boolean }) => {
    fx.enabled = input.enabled;
    if (input.enabled === false) return loadingOutcome(undefined);
    return readyOutcome({ rows: [], complete: true });
  },
}));

describe("activity page completeness", () => {
  beforeEach(() => {
    fx.connected = true;
    fx.ovrflosStatus = "ready";
    fx.marketsStatus = "ready";
    fx.enabled = undefined;
  });

  afterEach(() => {
    resetDisclosure();
  });

  it("keeps activity incomplete when market discovery is unavailable", () => {
    fx.marketsStatus = "unavailable";
    render(<ActivityPage />);
    expect(fx.enabled).toBe(false);
    expect(screen.getByText("INCOMPLETE")).toBeInTheDocument();
    expect(screen.queryByText("No confirmed activity yet.")).not.toBeInTheDocument();
  });

  it("shows empty activity only after a complete scan", () => {
    render(<ActivityPage />);
    expect(fx.enabled).toBe(true);
    expect(screen.queryByText("INCOMPLETE")).not.toBeInTheDocument();
    expect(screen.getByText("No confirmed activity yet.")).toBeInTheDocument();
  });
});
