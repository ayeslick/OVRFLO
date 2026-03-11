import { render, screen } from "@testing-library/react";
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
    tokenLabels: {},
    marketLabels: {},
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
        seriesLabel: "PT-sUSDe Sep 2026",
        withdrawableLabel: "24,480 OVRUSDC",
        endDateLabel: "30 Sep 2026",
        progressPct: 62,
        claimable: true,
      },
      "mock-stream-102": {
        seriesLabel: "PT-eUSDe Dec 2026",
        withdrawableLabel: "18,920 OVRUSDC",
        endDateLabel: "30 Dec 2026",
        progressPct: 44,
        claimable: true,
      },
      "mock-stream-201": {
        seriesLabel: "PT-USDT Mar 2027",
        withdrawableLabel: "9,340 OVRUSDT",
        endDateLabel: "31 Mar 2027",
        progressPct: 31,
        claimable: false,
      },
      "mock-stream-301": {
        seriesLabel: "PT-sUSDe Feb 2025",
        withdrawableLabel: "0 OVRUSDC",
        endDateLabel: "28 Feb 2025",
        progressPct: 100,
        claimable: false,
        actionLabel: "Closed",
      },
    },
    createFlows: {},
    claimFlows: {},
    actionsDisabled: true,
    isPreview: true,
    launchReadError: undefined,
  });
});

describe("Dashboard", () => {
  it("renders the single-page shell without stats or tabs", () => {
    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "My OVRFLOs" })).toBeInTheDocument();
    expect(screen.getByText("stream-list:4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New OVRFLO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    expect(screen.queryByText("Portfolio value")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Active/i })).not.toBeInTheDocument();
    expect(screen.queryByText("OVRFLO preview mode")).not.toBeInTheDocument();
  });

  it("shows an actionable factory-read error and disables actions", () => {
    useDashboardDataMock.mockReturnValue({
      tokenLabels: {},
      marketLabels: {},
      ovrflos: [],
      allMarkets: [],
      streams: [],
      streamCards: {},
      createFlows: {},
      claimFlows: {},
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