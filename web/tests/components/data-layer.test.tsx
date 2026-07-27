import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const walletState = { address: testAddress(0xa11) as Address | undefined };

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: walletState.address ? "connected" : "disconnected",
    addresses: walletState.address ? [walletState.address] : [],
  }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

type WriteFlowState = {
  writeContract: ReturnType<typeof vi.fn>;
  hash: undefined;
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  error: null;
};

function flow(overrides: Partial<WriteFlowState> = {}): WriteFlowState {
  return {
    writeContract: vi.fn(),
    hash: undefined,
    isSigning: false,
    isConfirming: false,
    isConfirmed: false,
    error: null,
    ...overrides,
  };
}

// Forms call useWriteFlow twice per render: approveTx first, actionTx second.
const writeFlows = { approve: flow(), action: flow(), calls: 0 };

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => (writeFlows.calls++ % 2 === 0 ? writeFlows.approve : writeFlows.action),
}));

const hookData = {
  loans: [] as unknown[],
  liquidity: [] as unknown[],
  pools: [] as unknown[],
  streams: [] as unknown[],
  tooLarge: false,
};

vi.mock("@/hooks/useBorrowerLoans", () => ({
  useBorrowerLoans: () => ({ loans: hookData.loans, tooLarge: hookData.tooLarge, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLenderPools", () => ({
  useLenderPools: () => ({ pools: hookData.pools, tooLarge: false, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({ liquidity: hookData.liquidity, tooLarge: false, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: hookData.streams, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 2000, feeBps: 40, nextLiquidityId: 1n, nextLoanId: 1n, nextSaleListingId: 1n },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useBorrowDemand", () => ({
  useBorrowDemand: () => ({ status: "ok", demand: [], peak: 0n }),
}));

import { FormBody } from "@/components/ActionModal";
import { PositionList } from "@/components/PositionList";
import { MarketsTable } from "@/components/MarketsTable";

const market: MarketInfo = {
  vault: testAddress(1),
  treasury: testAddress(2),
  underlying: testAddress(3),
  ovrfloToken: testAddress(4),
  lending: testAddress(5),
  market: testAddress(6),
  twapDurationFixed: 900,
  feeBps: 25,
  expiryCached: 99999999999n,
  ptToken: testAddress(7),
  oracle: testAddress(8),
};

const marketB: MarketInfo = {
  ...market,
  vault: testAddress(11),
  underlying: testAddress(13),
  ovrfloToken: testAddress(14),
  market: testAddress(16),
};

const symbols = {
  [market.underlying.toLowerCase()]: "TESTA",
  [market.ovrfloToken.toLowerCase()]: "ovrfloTESTA",
  [marketB.underlying.toLowerCase()]: "TESTB",
  [marketB.ovrfloToken.toLowerCase()]: "ovrfloTESTB",
};

beforeEach(() => {
  walletState.address = testAddress(0xa11);
  writeFlows.approve = flow();
  writeFlows.action = flow();
  writeFlows.calls = 0;
  hookData.loans = [];
  hookData.liquidity = [];
  hookData.pools = [];
  hookData.streams = [];
  hookData.tooLarge = false;
});

describe("approve/action split (KTD6/R24)", () => {
  it("never shows CONFIRMED or the close affordance from the approval receipt alone", () => {
    writeFlows.approve = flow({ isConfirmed: true });
    render(
      <FormBody action={{ type: "supply" }} market={market} symbols={symbols} accent="gold" onClose={vi.fn()} />,
    );
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByText("CLOSE")).not.toBeInTheDocument();
  });

  it("shows CONFIRMED and the close affordance only from the action receipt", () => {
    writeFlows.approve = flow({ isConfirmed: true });
    writeFlows.action = flow({ isConfirmed: true });
    render(
      <FormBody action={{ type: "supply" }} market={market} symbols={symbols} accent="gold" onClose={vi.fn()} />,
    );
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.getByText("CLOSE")).toBeInTheDocument();
  });
});

describe("real symbols per market (KTD7/R25)", () => {
  it("renders each market's own symbol with no hardcoded literal", () => {
    render(<MarketsTable markets={[market, marketB]} symbols={symbols} onSelect={vi.fn()} onMode={vi.fn()} />);
    expect(screen.getByText(/ovrfloTESTA/)).toBeInTheDocument();
    expect(screen.getByText(/ovrfloTESTB/)).toBeInTheDocument();
    expect(screen.queryByText(/wstETH/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ovrflo$/)).not.toBeInTheDocument();
  });

  it("threads symbols into position rows", () => {
    hookData.liquidity = [
      { id: 1n, lender: testAddress(0xa11), market: market.market, aprBps: 1000, availableLiquidity: 5n * 10n ** 18n },
    ];
    render(<PositionList market={market} user={testAddress(0xa11)} symbols={symbols} onAction={vi.fn()} />);
    expect(screen.getByText(/TESTA/)).toBeInTheDocument();
    expect(screen.queryByText(/wstETH/)).not.toBeInTheDocument();
  });
});

describe("close gate (R17)", () => {
  const baseLoan = {
    loan: { id: 1n, borrower: testAddress(0xa11), streamId: 9n, obligation: 100n, drawn: 0n, repaid: 0n, closed: false },
    pool: { id: 1n, borrower: testAddress(0xa11), aprBps: 1000, market: market.market, totalContributed: 100n },
  };

  it("hides CLOSE when the stream cannot cover the outstanding obligation", () => {
    hookData.loans = [{ ...baseLoan, withdrawable: 40n }];
    render(<PositionList market={market} user={testAddress(0xa11)} symbols={symbols} onAction={vi.fn()} />);
    expect(screen.queryByText("CLOSE")).not.toBeInTheDocument();
    // Repay lives behind the ADVANCED disclosure on card loans (ticket 08).
    fireEvent.click(screen.getByRole("button", { name: /ADVANCED/ }));
    expect(screen.getByText("REPAY EARLY")).toBeInTheDocument();
  });

  it("shows CLOSE when the stream covers the outstanding obligation", () => {
    hookData.loans = [{ ...baseLoan, withdrawable: 100n }];
    render(<PositionList market={market} user={testAddress(0xa11)} symbols={symbols} onAction={vi.fn()} />);
    expect(screen.getByText("CLOSE")).toBeInTheDocument();
  });
});

describe("truncation warning (R26)", () => {
  it("renders the generic truncation copy when an enumeration hook reports tooLarge", () => {
    hookData.tooLarge = true;
    hookData.loans = [
      {
        loan: { id: 1n, borrower: testAddress(0xa11), streamId: 9n, obligation: 100n, drawn: 0n, repaid: 0n, closed: false },
        pool: { id: 1n, borrower: testAddress(0xa11), aprBps: 1000, market: market.market, totalContributed: 100n },
        withdrawable: 0n,
      },
    ];
    render(<PositionList market={market} user={testAddress(0xa11)} symbols={symbols} onAction={vi.fn()} />);
    expect(screen.getByText("SHOWING FIRST 500 — DATA TRUNCATED")).toBeInTheDocument();
  });
});

describe("wallet-change reset (R30)", () => {
  it("replaces the form body with WALLET CHANGED — RE-ENTER and resets entered state", () => {
    const { rerender } = render(
      <FormBody action={{ type: "supply" }} market={market} symbols={symbols} accent="gold" onClose={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "1.5" } });
    expect((input as HTMLInputElement).value).toBe("1.5");

    walletState.address = testAddress(0xb22);
    rerender(
      <FormBody action={{ type: "supply" }} market={market} symbols={symbols} accent="gold" onClose={vi.fn()} />,
    );

    expect(screen.getByText("WALLET CHANGED — RE-ENTER")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("0.00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("CONTINUE"));
    const freshInput = screen.getByPlaceholderText("0.00");
    expect((freshInput as HTMLInputElement).value).toBe("");
  });
});
