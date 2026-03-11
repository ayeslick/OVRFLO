import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { SablierStream } from "@/lib/sablier";

type HexAddress = `0x${string}`;

export interface MockStreamCardData {
  seriesLabel: string;
  withdrawableLabel: string;
  endDateLabel: string;
  progressPct: number;
  claimable: boolean;
  actionLabel?: string;
}

export interface MockCreateFlowData {
  ptBalance: string;
  immediate: string;
  streamed: string;
  fee: string;
  minReceived: string;
  streamEnds: string;
  needsPtApproval?: boolean;
  needsUnderlyingApproval?: boolean;
  marketMaturesSoon?: boolean;
}

export interface MockClaimFlowData {
  ovrfloBalance: string;
  ptReserves: string;
  maxAmount: string;
  receiveAmount: string;
}

export interface MockDashboardData {
  tokenLabels: Record<HexAddress, string>;
  marketLabels: Record<HexAddress, string>;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  streams: SablierStream[];
  streamCards: Record<string, MockStreamCardData>;
  createFlows: Record<HexAddress, MockCreateFlowData>;
  claimFlows: Record<HexAddress, MockClaimFlowData>;
}

const addr = (value: string) => value as HexAddress;

export const MOCK_DASHBOARD_DATA: MockDashboardData = {
  tokenLabels: {
    [addr("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")]: "USDC",
    [addr("0xdAC17F958D2ee523a2206206994597C13D831ec7")]: "USDT",
    [addr("0x3000000000000000000000000000000000000002")]: "PT-sUSDe",
    [addr("0x4000000000000000000000000000000000000002")]: "PT-eUSDe",
    [addr("0x5000000000000000000000000000000000000002")]: "PT-USDT",
    [addr("0x6000000000000000000000000000000000000002")]: "PT-sUSDe Feb 2025",
    [addr("0x1000000000000000000000000000000000000003")]: "OVRUSDC",
    [addr("0x2000000000000000000000000000000000000003")]: "OVRUSDT",
  },
  marketLabels: {
    [addr("0x3000000000000000000000000000000000000001")]: "PT-sUSDe Sep 2026",
    [addr("0x4000000000000000000000000000000000000001")]: "PT-eUSDe Dec 2026",
    [addr("0x5000000000000000000000000000000000000001")]: "PT-USDT Mar 2027",
    [addr("0x6000000000000000000000000000000000000001")]: "PT-sUSDe Feb 2025",
  },
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
    {
      market: addr("0x6000000000000000000000000000000000000001"),
      ovrflo: addr("0x1000000000000000000000000000000000000001"),
      approved: true,
      twapDuration: 900,
      feeBps: 75,
      expiry: 1740700800n,
      ptToken: addr("0x6000000000000000000000000000000000000002"),
      ovrfloToken: addr("0x1000000000000000000000000000000000000003"),
      underlying: addr("0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
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
      claimable: true,
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
  createFlows: {
    [addr("0x3000000000000000000000000000000000000001")]: {
      ptBalance: "125 PT-sUSDe",
      immediate: "61.7 USDC",
      streamed: "37.4 OVRUSDC",
      fee: "0.9 USDC",
      minReceived: "61.39 USDC",
      streamEnds: "30 Sep 2026",
      needsPtApproval: true,
      needsUnderlyingApproval: true,
    },
    [addr("0x4000000000000000000000000000000000000001")]: {
      ptBalance: "98 PT-eUSDe",
      immediate: "47.8 USDC",
      streamed: "29.6 OVRUSDC",
      fee: "0.7 USDC",
      minReceived: "47.56 USDC",
      streamEnds: "30 Dec 2026",
      needsPtApproval: true,
      needsUnderlyingApproval: false,
    },
    [addr("0x5000000000000000000000000000000000000001")]: {
      ptBalance: "63 PT-USDT",
      immediate: "31.4 USDT",
      streamed: "20.1 OVRUSDT",
      fee: "0.6 USDT",
      minReceived: "31.24 USDT",
      streamEnds: "31 Mar 2027",
      needsPtApproval: false,
      needsUnderlyingApproval: true,
    },
  },
  claimFlows: {
    [addr("0x6000000000000000000000000000000000000001")]: {
      ovrfloBalance: "12,400 OVRUSDC",
      ptReserves: "18,100 PT-sUSDe",
      maxAmount: "12,400",
      receiveAmount: "12,400 PT-sUSDe Feb 2025",
    },
  },
};