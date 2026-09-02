"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { WalletButton } from "wallet-runtime";
import { RegionErrorBoundary } from "@/components/ModalErrorBoundary";
import { ActionButton } from "@/components/kit/ActionButton";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useFreshness } from "@/hooks/useFreshness";
import { useMarketSymbols, symbolFor } from "@/hooks/useMarketSymbols";
import { classifySurfaceState } from "@/lib/surface-state";
import { parseAddressParam } from "@/lib/parse";
import { ConverterFlow } from "./ConverterFlow";
import { StreamCreateFlow } from "./StreamCreateFlow";
import { asOfClock } from "./helpers";
import "./assets.css";

export function AssetsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const connection = useConnection();
  const queryClient = useQueryClient();
  const chain = useChainGuard();
  const allMarkets = useAllMarkets();
  const symbols = useMarketSymbols(allMarkets.markets);
  const flowParam = params.get("flow");
  const flow = flowParam === "stream" ? "stream" : "convert";
  const returnLoan = params.get("loan");
  const returnLending = parseAddressParam(params.get("lending"));
  const repayHref =
    params.get("return") === "repay"
      ? returnLending && returnLoan && /^(0|[1-9][0-9]*)$/.test(returnLoan)
        ? `/?lending=${returnLending}&loan=${returnLoan}`
        : "/"
      : undefined;
  const requestedMarket = parseAddressParam(params.get("market"));
  const [pickedMarket, setPickedMarket] = useState<string | null>(null);

  const freshness = useFreshness([
    {
      status: allMarkets.isLoading ? "pending" : allMarkets.error ? "error" : "success",
    },
  ]);

  const selected =
    allMarkets.markets.find((row) => row.market === (pickedMarket ?? requestedMarket)) ??
    allMarkets.markets[0] ??
    null;

  const underlyingSymbol = selected
    ? symbolFor(symbols, selected.underlying)
    : "the market's underlying";
  const ovrfloSymbol = selected
    ? symbolFor(symbols, selected.ovrfloToken)
    : "the market's ovrflo token";

  const marketStatus = useMemo(() => {
    if (allMarkets.status === "loading") return "loading" as const;
    if (allMarkets.status === "unavailable") return "unavailable" as const;
    if (allMarkets.markets.length === 0) return "empty" as const;
    return "ready" as const;
  }, [allMarkets.markets.length, allMarkets.status]);

  const surface = classifySurfaceState({
    dataStatus:
      marketStatus === "loading"
        ? "loading"
        : marketStatus === "empty"
          ? "empty"
          : marketStatus === "unavailable"
            ? "unavailable"
            : "ready",
    hasLastKnown: marketStatus === "ready",
    stale: !freshness.signingAllowed,
    signingAllowed: freshness.signingAllowed,
  });

  return (
    <Shell
      currentNav={null}
      wallet={<WalletButton />}
      status={
        <StatusLine
          status={freshness.freshness.kind}
          asOf={asOfClock(freshness.freshness.asOf)}
        />
      }
    >
      <div className="assets-page">
        <SurfaceState
          state={surface}
          topology="assets"
          onRefresh={
            surface === "STALE"
              ? () => {
                  void queryClient.invalidateQueries();
                }
              : undefined
          }
        />
        {connection.status !== "connected" ? (
          <div className="assets-banner">
            <p>CONNECT WALLET to wrap, unwrap, or create a stream.</p>
          </div>
        ) : null}
        {chain.wrongChain ? (
          <div className="assets-banner">
            <p>Wrong network. Switch to the configured chain before signing.</p>
            <ActionButton onClick={chain.switchChain} busy={chain.isSwitching}>
              SWITCH NETWORK
            </ActionButton>
          </div>
        ) : null}

        <div className="assets-modes" role="tablist" aria-label="Assets utilities">
          <button
            type="button"
            role="tab"
            data-current={flow === "convert" ? "true" : "false"}
            aria-selected={flow === "convert"}
            onClick={() => router.replace("/assets/")}
          >
            CONVERT
          </button>
          <button
            type="button"
            role="tab"
            data-current={flow === "stream" ? "true" : "false"}
            aria-selected={flow === "stream"}
            onClick={() => router.replace("/assets/?flow=stream")}
          >
            CREATE STREAM
          </button>
        </div>

        {flow === "convert" && allMarkets.markets.length > 1 ? (
          <label className="assets-note" htmlFor="assets-market">
            MARKET{" "}
            <select
              id="assets-market"
              value={selected?.market ?? ""}
              onChange={(event) => setPickedMarket(event.target.value)}
            >
              {allMarkets.markets.map((row) => (
                <option key={row.market} value={row.market}>
                  {symbolFor(symbols, row.underlying)} · {row.market.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {flow === "stream" ? (
          <RegionErrorBoundary region="assets-stream">
          <StreamCreateFlow
            markets={allMarkets.markets}
            marketsStatus={marketStatus}
            symbolFor={(address) => symbolFor(symbols, address)}
            signingAllowed={freshness.signingAllowed && !chain.wrongChain}
          />
          </RegionErrorBoundary>
        ) : (
          <RegionErrorBoundary region="assets-convert">
          <ConverterFlow
            market={selected}
            underlyingSymbol={underlyingSymbol}
            ovrfloSymbol={ovrfloSymbol}
            repayHref={repayHref}
            signingAllowed={freshness.signingAllowed && !chain.wrongChain}
          />
          </RegionErrorBoundary>
        )}
      </div>
    </Shell>
  );
}
