import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAccountMock = vi.fn();
const useUserStreamsMock = vi.fn();
const useTokenSymbolsMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
}));

vi.mock("@/hooks/useStreams", () => ({
  useUserStreams: (...args: unknown[]) => useUserStreamsMock(...args),
}));

vi.mock("@/hooks/useTokenLabels", () => ({
  useTokenSymbols: (...args: unknown[]) => useTokenSymbolsMock(...args),
  getTokenSymbol: () => undefined,
}));

vi.mock("@/components/StreamCard", () => ({
  StreamCard: () => <div>stream-card</div>,
}));

const { StreamList } = await import("@/components/StreamList");

const ovrflo = {
  address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  treasury: "0x0000000000000000000000000000000000000002" as `0x${string}`,
  underlying: "0x0000000000000000000000000000000000000003" as `0x${string}`,
  ovrfloToken: "0x0000000000000000000000000000000000000004" as `0x${string}`,
};

beforeEach(() => {
  useAccountMock.mockReturnValue({
    address: "0x0000000000000000000000000000000000000005",
  });
  useTokenSymbolsMock.mockReturnValue({});
  useUserStreamsMock.mockReturnValue({
    data: [],
    isLoading: false,
    error: undefined,
  });
});

describe("StreamList", () => {
  it("renders an actionable indexer error instead of an empty state", () => {
    useUserStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Sablier indexer returned 502"),
    });

    render(<StreamList ovrflos={[ovrflo]} allMarkets={[]} />);

    expect(screen.getByText("Unable to load your streams")).toBeInTheDocument();
    expect(screen.getByText(/Sablier indexer returned 502/i)).toBeInTheDocument();
  });

  it("distinguishes an empty factory from an empty wallet stream list", () => {
    render(<StreamList ovrflos={[]} allMarkets={[]} />);

    expect(
      screen.getByText(/No OVRFLO markets are currently available from the configured factory/i)
    ).toBeInTheDocument();
  });
});
