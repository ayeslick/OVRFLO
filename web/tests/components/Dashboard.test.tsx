import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SablierStream } from "@/lib/sablier";

const useDashboardDataMock = vi.fn();

const previewStream = (id: string, tokenId: string): SablierStream => ({
  id,
  tokenId,
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
});

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => useDashboardDataMock(),
}));

vi.mock("@/components/WrongNetworkBanner", () => ({
  WrongNetworkBanner: () => <div>wrong-network-banner</div>,
}));

vi.mock("@/components/StreamList", () => ({
  StreamList: ({
    preview,
  }: {
    preview?: {
      streams: Array<{ id: string }>;
    };
  }) => <div>{`stream-list:${preview?.streams.length ?? 0}`}</div>,
}));

vi.mock("@/components/NewOvrfloModal", () => ({
  NewOvrfloModal: () => null,
}));

vi.mock("@/components/ClaimModal", () => ({
  ClaimModal: () => null,
}));

const { Dashboard } = await import("@/components/Dashboard");

beforeEach(() => {
  useDashboardDataMock.mockReturnValue({
    badge: "OVRFLO preview mode",
    title: "Split PT into principal now and stream the rest.",
    subtitle: "Mock subtitle",
    updatedAt: "Snapshot refreshed",
    heroStats: [
      { label: "Portfolio value", value: "$332K", detail: "4 total positions" },
      { label: "Available to claim", value: "$43.4K", detail: "2 positions ready" },
      { label: "Average fixed APR", value: "12.8%", detail: "Across active PT maturities" },
      { label: "Next maturity", value: "30 Sep 2026", detail: "PT-sUSDe Sep 2026" },
    ],
    mechanicSteps: [
      {
        title: "Deposit PT",
        body: "Deposit body",
        value: "100 PT-sUSDe",
      },
    ],
    mechanicExample: {
      depositPt: "100 PT-sUSDe",
      principalNow: "61.7 USDC immediate",
      streamedValue: "37.4 OVRUSDC streamed",
      fee: "0.9 USDC fee",
    },
    insightCards: [
      { eyebrow: "Preview seam", title: "One mock source powers the full shell.", body: "Body" },
    ],
    ovrflos: [],
    allMarkets: [],
    streams: [
      previewStream("mock-stream-101", "101"),
      previewStream("mock-stream-102", "102"),
      previewStream("mock-stream-201", "201"),
      previewStream("mock-stream-301", "301"),
    ],
    streamCards: {
      "mock-stream-101": {
        badge: "Claim ready",
        seriesLabel: "PT-sUSDe Sep 2026",
        metricLabel: "Available now",
        metricValue: "24,480 OVRUSDC · $24.5K",
        metricContext: "62% matured",
        depositedValue: "$125K deposited",
        maturityLabel: "Ends 30 Sep 2026",
        feeLabel: "0.0009 ETH execution fee",
        progressPct: 62,
        claimable: true,
      },
      "mock-stream-102": {
        badge: "Streaming",
        seriesLabel: "PT-eUSDe Dec 2026",
        metricLabel: "Available now",
        metricValue: "18,920 OVRUSDC · $18.9K",
        metricContext: "44% matured",
        depositedValue: "$98K deposited",
        maturityLabel: "Ends 30 Dec 2026",
        feeLabel: "0.0007 ETH execution fee",
        progressPct: 44,
        claimable: true,
      },
      "mock-stream-201": {
        badge: "Treasury sleeve",
        seriesLabel: "PT-USDT Mar 2027",
        metricLabel: "Available now",
        metricValue: "9,340 OVRUSDT · $9.3K",
        metricContext: "31% matured",
        depositedValue: "$63K deposited",
        maturityLabel: "Ends 31 Mar 2027",
        feeLabel: "0.0011 ETH execution fee",
        progressPct: 31,
        claimable: false,
      },
      "mock-stream-301": {
        badge: "Closed",
        seriesLabel: "PT-sUSDe Feb 2025",
        metricLabel: "Final claim",
        metricValue: "46,000 OVRUSDC · $46.0K",
        metricContext: "Settled 02 Mar 2025",
        depositedValue: "$46K deposited",
        maturityLabel: "Closed 28 Feb 2025",
        feeLabel: "0.0000 ETH execution fee",
        progressPct: 100,
        claimable: false,
        closed: true,
      },
    },
    actionsDisabled: true,
    isPreview: true,
    launchReadError: undefined,
  });
});

describe("Dashboard", () => {
  it("renders the app-first shell and switches portfolio tabs", () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.getByText("Portfolio value")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Active/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Claimable/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Closed/i })).toBeInTheDocument();
    expect(screen.getByText("stream-list:3")).toBeInTheDocument();
    expect(screen.queryByText("OVRFLO preview mode")).not.toBeInTheDocument();
    expect(screen.queryByText("One mock source powers the full shell.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deposit PT" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: /Claimable/i }));
    expect(screen.getByRole("tab", { name: /Claimable/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("stream-list:2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Closed/i }));
    expect(screen.getByRole("tab", { name: /Closed/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("stream-list:1")).toBeInTheDocument();
  });

  it("shows an actionable factory-read error and disables actions", () => {
    useDashboardDataMock.mockReturnValue({
      badge: "OVRFLO dashboard preview",
      title: "Premium fixed-income flow, mocked for product preview.",
      subtitle: "Mock subtitle",
      updatedAt: "Snapshot refreshed",
      heroStats: [],
      mechanicSteps: [],
      mechanicExample: {
        depositPt: "0",
        principalNow: "0",
        streamedValue: "0",
        fee: "0",
      },
      insightCards: [],
      ovrflos: [],
      allMarkets: [],
      streams: [],
      streamCards: {},
      actionsDisabled: true,
      isPreview: false,
      launchReadError: new Error("factory unavailable"),
    });

    render(<Dashboard />);

    expect(screen.getByText("Launch data unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
  });
});