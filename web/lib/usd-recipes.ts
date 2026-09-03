import { isAddressEqual, type Address } from "viem";
import { CHAINLINK_STETH_USD, WSTETH_ADDRESS } from "./config";

export type UsdRecipeKind =
  | "chainlink-usd-times-share-rate"
  | "chainlink-usd-direct"
  | "chainlink-eth-usd-times-eth-rate";

export type UsdShareRateSpec = {
  contract: Address;
  functionName: "stEthPerToken" | "getPooledEthByShares";
};

export type UsdRecipe = {
  underlying: Address;
  kind: UsdRecipeKind;
  aggregator: Address;
  feedDecimals: number;
  heartbeatSeconds: bigint;
  shareRate?: UsdShareRateSpec;
  ethUsdAggregator?: Address;
  explorerVerifiedAt: string;
  explorerUrl: string;
  maxSourceDeviationBps: bigint;
};

/**
 * Per-underlying USD recipes. A later column adds a reviewed row.
 * Never default a missing row to wstETH.
 */
export const USD_RECIPES: readonly UsdRecipe[] = [
  {
    underlying: WSTETH_ADDRESS,
    kind: "chainlink-usd-times-share-rate",
    aggregator: CHAINLINK_STETH_USD,
    feedDecimals: 8,
    heartbeatSeconds: 3_600n,
    shareRate: { contract: WSTETH_ADDRESS, functionName: "stEthPerToken" },
    explorerVerifiedAt: "2026-08-12",
    explorerUrl: "https://etherscan.io/address/0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8",
    maxSourceDeviationBps: 50n,
  },
];

export function lookupUsdRecipe(underlying: Address): UsdRecipe | null {
  return USD_RECIPES.find((row) => isAddressEqual(row.underlying, underlying)) ?? null;
}
