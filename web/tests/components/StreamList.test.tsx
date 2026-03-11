import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SablierStream } from "@/lib/sablier";

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

vi.mock("@/components/PreviewStreamCard", () => ({
  PreviewStreamCard: ({ label }: { label: string }) => <div>{label}</div>,
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
  it("renders preview streams without requiring a connected wallet", () => {
    useAccountMock.mockReturnValue({ address: undefined });

    const previewStream: SablierStream = {
      id: "mock-stream-101",
      tokenId: "101",
      depositAmount: "0",
      withdrawnAmount: "0",
      startTime: "1738368000",
      endTime: "1790726400",
      canceled: false,
      depleted: false,
      intactAmount: "0",
      asset: {
        symbol: "OVRUSDC",
        decimals: 18,
        address: "0x0000000000000000000000000000000000000004",
      },
      sender: "0x0000000000000000000000000000000000000001",
    };

    render(
      <StreamList
        ovrflos={[ovrflo]}
        allMarkets={[]}
        preview={{
          streams: [previewStream],
          streamCards: {
            "mock-stream-101": {
              seriesLabel: "PT-sUSDe Sep 2026",
              withdrawableLabel: "24,480 OVRUSDC",
              endDateLabel: "30 Sep 2026",
              progressPct: 62,
              claimable: true,
            },
          },
        }}
      />
    );

    expect(screen.getByText("PT-sUSDe Sep 2026")).toBeInTheDocument();
    expect(
      screen.queryByText(/Connect wallet to view your streams/i)
    ).not.toBeInTheDocument();
  });

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

  it("shows the simplified empty state when there are no OVRFLOs", () => {
    render(<StreamList ovrflos={[]} allMarkets={[]} />);

    expect(screen.getByText("No OVRFLOs yet.")).toBeInTheDocument();
  });
});
