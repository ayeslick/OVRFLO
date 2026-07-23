"use client";

import type { Address } from "viem";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLenderPools } from "@/hooks/useLenderPools";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import type { MarketInfo } from "@/lib/types";

type Props = {
  markets: MarketInfo[];
  user?: Address;
};

export function PositionSummary({ markets, user }: Props) {
  const streams = useHeldStreams(user);

  if (!user) return null;

  const lendingMarkets = markets.filter(
    (m): m is MarketInfo & { lending: Address } => m.lending !== null,
  );
  const anyLoading =
    streams.isLoading ||
    (lendingMarkets.length === 0 && false);

  if (anyLoading) {
    return (
      <section className="section">
        <div className="label mono">YOUR POSITIONS</div>
        <div className="empty mono">LOADING</div>
      </section>
    );
  }

  if (lendingMarkets.length === 0 && streams.streams.length === 0) return null;

  return (
    <section className="section">
      <div className="label mono">YOUR POSITIONS</div>
      <div className="position-summary">
        {lendingMarkets.map((m) => (
          <PositionSummaryMarket key={m.lending} lending={m.lending} user={user} />
        ))}
        {streams.streams.length > 0 ? (
          <div className="mono">STREAMS: {streams.streams.length}</div>
        ) : null}
      </div>
    </section>
  );
}

function PositionSummaryMarket({ lending, user }: { lending: Address; user: Address }) {
  const liquidity = useLendingLiquidity(lending);
  const pools = useLenderPools(lending, user);
  const loans = useBorrowerLoans(lending, user);

  if (liquidity.isLoading || pools.isLoading || loans.isLoading) {
    return <div className="empty mono">LOADING</div>;
  }

  const normalizedUser = user.toLowerCase();
  const lendingCount = liquidity.liquidity.filter(
    (p) => p.lender.toLowerCase() === normalizedUser,
  ).length;
  const poolCount = pools.pools.length;
  const loanCount = loans.loans.length;

  if (lendingCount === 0 && poolCount === 0 && loanCount === 0) return null;

  return (
    <>
      {lendingCount + poolCount > 0 ? (
        <div className="mono">LENDING: {lendingCount + poolCount}</div>
      ) : null}
      {loanCount > 0 ? <div className="mono">BORROWING: {loanCount}</div> : null}
    </>
  );
}
