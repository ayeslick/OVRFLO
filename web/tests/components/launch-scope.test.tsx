import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { MarketDetail } from "@/components/MarketDetail";
import { MarketsTable } from "@/components/MarketsTable";
import type { MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

vi.mock("wagmi", () => ({
  useConnection: () => ({ status: "disconnected", addresses: [] }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false, error: null }),
  useWriteContract: () => ({ writeContract: vi.fn(), isPending: false, data: undefined, error: null }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false, error: null }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

const market: MarketInfo = {
  vault: testAddress(1),
  treasury: testAddress(2),
  underlying: testAddress(3),
  ovrfloToken: testAddress(4),
  lending: testAddress(5),
  market: testAddress(6),
  twapDurationFixed: 900,
  feeBps: 25,
  expiryCached: 1782345600n,
  ptToken: testAddress(7),
  oracle: testAddress(8),
};

describe("launch scope", () => {
  it("renders market detail actions without listing storefront copy", () => {
    render(<MarketDetail market={market} onBack={vi.fn()} />);
    expect(screen.getByText("SUPPLY LIQUIDITY")).toBeInTheDocument();
    expect(screen.getByText("BORROW")).toBeInTheDocument();
    expect(screen.queryByText(/BUY/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/LIST FOR SALE/i)).not.toBeInTheDocument();
  });

  it("keeps the markets table launch columns free of FOR SALE", () => {
    render(<MarketsTable markets={[market]} selected={market} onSelect={vi.fn()} />);
    expect(screen.queryByText("For sale")).not.toBeInTheDocument();
  });
});
