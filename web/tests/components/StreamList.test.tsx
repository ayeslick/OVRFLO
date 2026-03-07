import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useAccountMock = vi.fn();
const useUserStreamsMock = vi.fn();
const useReadContractsMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useReadContracts: (...args: unknown[]) => useReadContractsMock(...args),
}));

vi.mock("@/hooks/useStreams", () => ({
  useUserStreams: (...args: unknown[]) => useUserStreamsMock(...args),
}));

const { StreamList } = await import("@/components/StreamList");

describe("StreamList", () => {
  it("renders indexer error state distinctly from empty state", () => {
    useAccountMock.mockReturnValue({
      address: "0x0000000000000000000000000000000000000001",
    });
    useUserStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Sablier indexer returned 502"),
      refetch: vi.fn(),
    });
    useReadContractsMock.mockReturnValue({ data: undefined });

    render(<StreamList ovrflos={[]} allMarkets={[]} />);

    expect(screen.getByText(/unable to load stream data/i)).toBeInTheDocument();
    expect(screen.queryByText(/no active streams yet/i)).not.toBeInTheDocument();
  });
});
