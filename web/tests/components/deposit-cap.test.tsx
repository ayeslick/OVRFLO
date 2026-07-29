import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const walletState = { address: testAddress(0xa11) as Address | undefined };

const readState = {
  depositLimit: 0n as bigint,
  totalDeposited: 0n as bigint,
};

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: "connected",
    addresses: [walletState.address],
    chainId: 1,
  }),
  useSwitchChain: () => ({ switchChain: () => {}, isPending: false, error: null }),
  useReadContract: (config?: { functionName?: string }) => {
    switch (config?.functionName) {
      case "marketDepositLimits":
        return { data: readState.depositLimit, error: null };
      case "marketTotalDeposited":
        return { data: readState.totalDeposited, error: null };
      case "previewDeposit":
        return { data: [90n * WAD, 10n * WAD, 1n * WAD, 0n], error: null };
      case "allowance":
        return { data: 1_000_000n * WAD, error: null };
      case "balanceOf":
        return { data: 1_000_000n * WAD, error: null };
      default:
        return { data: undefined, error: null };
    }
  },
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

function flow() {
  return {
    writeContract: vi.fn(),
    reset: vi.fn(),
    hash: undefined,
    receipt: undefined,
    isSigning: false,
    isConfirming: false,
    isConfirmed: false,
    error: null,
  };
}
const writeFlows = { calls: 0, approve: flow(), action: flow() };
vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => (writeFlows.calls++ % 2 === 0 ? writeFlows.approve : writeFlows.action),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: [], isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({ liquidity: [], tooLarge: false, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 1200, feeBps: 40, nextLiquidityId: 1n, nextLoanId: 1n, nextSaleListingId: 1n },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useBorrowDemand", () => ({
  useBorrowDemand: () => ({ status: "ok", demand: [], peak: 0n }),
}));
vi.mock("@/lib/invalidate", () => ({
  invalidateAllOnChainReads: vi.fn(),
  scheduleHeldStreamsRetry: () => () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

import { FormBody } from "@/components/ActionModal";

const market: MarketInfo = {
  vault: testAddress(1),
  treasury: testAddress(2),
  underlying: testAddress(3),
  ovrfloToken: testAddress(4),
  lending: testAddress(5),
  market: testAddress(6),
  twapDurationFixed: 900,
  feeBps: 25,
  expiryCached: 99_999_999_999n,
  ptToken: testAddress(7),
  oracle: testAddress(8),
};

function renderDeposit() {
  render(
    <FormBody
      action={{ type: "deposit" }}
      market={market}
      user={walletState.address}
      symbols={{}}
      accent="gold"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  writeFlows.calls = 0;
  writeFlows.approve = flow();
  writeFlows.action = flow();
  readState.depositLimit = 0n;
  readState.totalDeposited = 0n;
});

describe("deposit cap edge state", () => {
  it("shows no cap line when the limit is zero (unlimited)", () => {
    renderDeposit();
    expect(screen.queryByText(/DEPOSIT CAP/)).not.toBeInTheDocument();
  });

  it("shows the cap and remaining headroom when a positive limit is set", () => {
    readState.depositLimit = 100n * WAD;
    readState.totalDeposited = 60n * WAD;
    renderDeposit();
    expect(screen.getByText("DEPOSIT CAP 100.00 PT / REMAINING 40.00 PT")).toBeInTheDocument();
  });

  it("rejects an amount above the remaining headroom", () => {
    readState.depositLimit = 100n * WAD;
    readState.totalDeposited = 60n * WAD;
    renderDeposit();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    expect(screen.getByText("EXCEEDS DEPOSIT CAP — REMAINING 40.00 PT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DEPOSIT" })).toBeDisabled();
  });

  it("disables deposit entirely with the cap shown when the cap is reached", () => {
    readState.depositLimit = 100n * WAD;
    readState.totalDeposited = 100n * WAD;
    renderDeposit();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    expect(screen.getByText("DEPOSIT CAP REACHED — 100.00 PT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DEPOSIT" })).toBeDisabled();
  });
});
