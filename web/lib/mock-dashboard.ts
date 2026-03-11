import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { SablierStream } from "@/lib/sablier";

type HexAddress = `0x${string}`;

export interface DashboardHeroStat {
  label: string;
  value: string;
  detail: string;
}

export interface DashboardInsightCard {
  eyebrow: string;
  title: string;
  body: string;
}

export interface DashboardMechanicStep {
  title: string;
  body: string;
  value: string;
}

export interface DashboardMechanicExample {
  depositPt: string;
  principalNow: string;
  streamedValue: string;
  fee: string;
}

export interface MockStreamCardData {
  badge: string;
  seriesLabel: string;
  metricLabel: string;
  metricValue: string;
  metricContext: string;
  depositedValue: string;
  maturityLabel: string;
  feeLabel: string;
  progressPct: number;
  claimable: boolean;
  closed?: boolean;
}

export interface MockDashboardData {
  badge: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  heroStats: DashboardHeroStat[];
  mechanicSteps: DashboardMechanicStep[];
  mechanicExample: DashboardMechanicExample;
  insightCards: DashboardInsightCard[];
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  streams: SablierStream[];
  streamCards: Record<string, MockStreamCardData>;
}

const addr = (value: string) => value as HexAddress;

export const MOCK_DASHBOARD_DATA: MockDashboardData = {
  badge: "OVRFLO preview mode",
  title: "Split PT into principal now and stream the rest.",
  subtitle:
    "This dashboard is fully mocked from one centralized preview source so the OVRFLO product flow stays populated while live reads remain paused.",
  updatedAt: "Snapshot refreshed 10 Mar 2026 · preview mode",
  heroStats: [
    {
      label: "Portfolio value",
      value: "$332K",
      detail: "4 total positions",
    },
    {
      label: "Available to claim",
      value: "$43.4K",
      detail: "2 positions ready",
    },
    {
      label: "Average fixed APR",
      value: "12.8%",
      detail: "Across active PT maturities",
    },
    {
      label: "Next maturity",
      value: "30 Sep 2026",
      detail: "PT-sUSDe Sep 2026",
    },
  ],
  mechanicSteps: [
    {
      title: "Deposit PT",
      body: "Choose an approved Pendle maturity and route PT into one OVRFLO sleeve.",
      value: "100 PT-sUSDe",
    },
    {
      title: "Take principal now",
      body: "OVRFLO converts part of the deposit into immediate underlying value up front.",
      value: "61.7 USDC now",
    },
    {
      title: "Stream remaining value",
      body: "The rest becomes a timed OVR token stream that can be claimed as it vests.",
      value: "37.4 OVRUSDC over time",
    },
  ],
  mechanicExample: {
    depositPt: "100 PT-sUSDe Sep 2026",
    principalNow: "61.7 USDC immediate",
    streamedValue: "37.4 OVRUSDC streamed",
    fee: "0.9 USDC fee",
  },
  insightCards: [
    {
      eyebrow: "Preview seam",
      title: "One mock source powers the full shell.",
      body:
        "Factory discovery, approved markets, hero copy, mechanic examples, and stream cards all read from this single checked-in module for maintainable preview mode.",
    },
    {
      eyebrow: "Mainnet stance",
      title: "Built for one chain and a simple flow.",
      body:
        "The UI keeps the launch posture obvious: Ethereum mainnet only, PT-focused onboarding, and clear claim / stream accounting without luxury-dashboard filler.",
    },
  ],
  ovrflos: [
    {
      address: addr("0x1000000000000000000000000000000000000001"),
      treasury: addr("0x1000000000000000000000000000000000000002"),
      underlying: addr("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
      ovrfloToken: addr("0x1000000000000000000000000000000000000003"),
    },
    {
      address: addr("0x2000000000000000000000000000000000000001"),
      treasury: addr("0x2000000000000000000000000000000000000002"),
      underlying: addr("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
      ovrfloToken: addr("0x2000000000000000000000000000000000000003"),
    },
  ],
  allMarkets: [
    {
      market: addr("0x3000000000000000000000000000000000000001"),
      ovrflo: addr("0x1000000000000000000000000000000000000001"),
      approved: true,
      twapDuration: 900,
      feeBps: 75,
      expiry: 1790726400n,
      ptToken: addr("0x3000000000000000000000000000000000000002"),
      ovrfloToken: addr("0x1000000000000000000000000000000000000003"),
      underlying: addr("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    },
    {
      market: addr("0x4000000000000000000000000000000000000001"),
      ovrflo: addr("0x1000000000000000000000000000000000000001"),
      approved: true,
      twapDuration: 900,
      feeBps: 70,
      expiry: 1798588800n,
      ptToken: addr("0x4000000000000000000000000000000000000002"),
      ovrfloToken: addr("0x1000000000000000000000000000000000000003"),
      underlying: addr("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    },
    {
      market: addr("0x5000000000000000000000000000000000000001"),
      ovrflo: addr("0x2000000000000000000000000000000000000001"),
      approved: true,
      twapDuration: 1200,
      feeBps: 90,
      expiry: 1806537600n,
      ptToken: addr("0x5000000000000000000000000000000000000002"),
      ovrfloToken: addr("0x2000000000000000000000000000000000000003"),
      underlying: addr("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    },
  ],
  streams: [
    {
      id: "mock-stream-101",
      tokenId: "101",
      depositAmount: "125000000000000000000000",
      withdrawnAmount: "21500000000000000000000",
      startTime: "1738368000",
      endTime: "1790726400",
      canceled: false,
      depleted: false,
      intactAmount: "103500000000000000000000",
      asset: {
        symbol: "OVRUSDC",
        decimals: 18,
        address: "0x1000000000000000000000000000000000000003",
      },
      sender: "0x1000000000000000000000000000000000000001",
    },
    {
      id: "mock-stream-102",
      tokenId: "102",
      depositAmount: "98000000000000000000000",
      withdrawnAmount: "12200000000000000000000",
      startTime: "1743465600",
      endTime: "1798588800",
      canceled: false,
      depleted: false,
      intactAmount: "85800000000000000000000",
      asset: {
        symbol: "OVRUSDC",
        decimals: 18,
        address: "0x1000000000000000000000000000000000000003",
      },
      sender: "0x1000000000000000000000000000000000000001",
    },
    {
      id: "mock-stream-201",
      tokenId: "201",
      depositAmount: "63000000000000000000000",
      withdrawnAmount: "9000000000000000000000",
      startTime: "1746057600",
      endTime: "1806537600",
      canceled: false,
      depleted: false,
      intactAmount: "54000000000000000000000",
      asset: {
        symbol: "OVRUSDT",
        decimals: 18,
        address: "0x2000000000000000000000000000000000000003",
      },
      sender: "0x2000000000000000000000000000000000000001",
    },
    {
      id: "mock-stream-301",
      tokenId: "301",
      depositAmount: "46000000000000000000000",
      withdrawnAmount: "46000000000000000000000",
      startTime: "1733011200",
      endTime: "1740700800",
      canceled: false,
      depleted: true,
      intactAmount: "0",
      asset: {
        symbol: "OVRUSDC",
        decimals: 18,
        address: "0x1000000000000000000000000000000000000003",
      },
      sender: "0x1000000000000000000000000000000000000001",
    },
  ],
  streamCards: {
    "mock-stream-101": {
      badge: "Claim ready",
      seriesLabel: "PT-sUSDe Sep 2026",
      metricLabel: "Available now",
      metricValue: "24,480 OVRUSDC · $24.5K",
      metricContext: "62% matured · main sleeve",
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
      metricContext: "44% matured · ladder two",
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
      metricContext: "31% matured · long sleeve",
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
};