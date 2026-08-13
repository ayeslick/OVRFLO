"use client";

import { useMemo, useState } from "react";
import { useConnection, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { Chooser } from "./Chooser";
import { Surface, type BalanceRead, type FirstRunMarket } from "./Surface";
import { useFirstRunDismissed } from "./dismiss";

/**
 * Guided first run for a wallet already confirmed protocol-empty by the U7
 * entry gate. This component does not re-decide emptiness.
 */
export function FirstRun() {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const dismiss = useFirstRunDismissed(account);
  const registry = useAllMarkets();
  const [chosen, setChosen] = useState<Address | null>(null);

  const markets = useMemo<FirstRunMarket[]>(
    () =>
      registry.markets.map((market) => ({
        market: market.market,
        ptToken: market.ptToken,
        ovrfloToken: market.ovrfloToken,
        underlying: market.underlying,
        expiryCached: market.expiryCached,
      })),
    [registry.markets],
  );

  const selected =
    markets.find((market) => market.market.toLowerCase() === chosen?.toLowerCase()) ??
    (markets.length === 1 ? markets[0] : null) ??
    null;
  const balanceMarket = selected ?? markets[0] ?? null;

  const symbolReads = useReadContracts({
    contracts: selected
      ? [
          { address: selected.ovrfloToken, abi: erc20Abi, functionName: "symbol" },
          { address: selected.underlying, abi: erc20Abi, functionName: "symbol" },
        ]
      : [],
    query: { enabled: Boolean(selected) },
  });

  const balanceReads = useReadContracts({
    contracts:
      account && balanceMarket
        ? [
            {
              address: balanceMarket.ptToken,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
            },
            {
              address: balanceMarket.underlying,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
            },
          ]
        : [],
    query: { enabled: Boolean(account && balanceMarket) },
  });

  const ovrfloSymbol = readSymbol(symbolReads.data?.[0]);
  const underlyingSymbol = readSymbol(symbolReads.data?.[1]);
  const ptBalance = classifyBalance({
    registryStatus: registry.status,
    hasMarket: Boolean(balanceMarket),
    result: balanceReads.data?.[0],
    isLoading: balanceReads.isLoading,
  });
  const underlyingBalance = classifyBalance({
    registryStatus: registry.status,
    hasMarket: Boolean(balanceMarket),
    result: balanceReads.data?.[1],
    isLoading: balanceReads.isLoading,
  });

  if (!account) return null;
  if (dismiss.dismissed) return <Chooser />;

  return (
    <Surface
      markets={markets}
      selectedMarket={selected}
      onSelectMarket={setChosen}
      ovrfloSymbol={ovrfloSymbol}
      underlyingSymbol={underlyingSymbol}
      ptBalance={ptBalance}
      underlyingBalance={underlyingBalance}
      pendleConfiguredUrl={process.env.NEXT_PUBLIC_PENDLE_MARKET_URL}
      onDismiss={dismiss.dismiss}
    />
  );
}

function readSymbol(entry: { status?: string; result?: unknown } | undefined): string | null {
  if (entry?.status !== "success" || typeof entry.result !== "string") return null;
  const trimmed = entry.result.trim();
  return trimmed || null;
}

function classifyBalance({
  registryStatus,
  hasMarket,
  result,
  isLoading,
}: {
  registryStatus: "loading" | "unavailable" | "ready";
  hasMarket: boolean;
  result: { status?: string; result?: unknown } | undefined;
  isLoading: boolean;
}): BalanceRead {
  if (registryStatus === "loading" || (hasMarket && isLoading && result === undefined)) {
    return { status: "loading" };
  }
  if (registryStatus === "unavailable") return { status: "unavailable" };
  if (!hasMarket) return { status: "ready", value: 0n };
  if (result?.status === "success" && typeof result.result === "bigint") {
    return { status: "ready", value: result.result };
  }
  if (result?.status === "failure") return { status: "unavailable" };
  if (isLoading) return { status: "loading" };
  return { status: "unavailable" };
}
