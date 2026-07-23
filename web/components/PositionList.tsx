"use client";

import type { Address } from "viem";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLenderPools } from "@/hooks/useLenderPools";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { formatAddress, formatId, formatTokenAmount } from "@/lib/format";
import { isLoanOpen, loanOutstanding } from "@/lib/lending-math";
import { isSeriesMatchedStream } from "@/lib/modal-logic";
import type { ActiveAction, MarketInfo } from "@/lib/types";

type Props = {
  market: MarketInfo;
  user?: Address;
  onAction: (action: ActiveAction) => void;
};

export function PositionList({ market, user, onAction }: Props) {
  const liquidity = useLendingLiquidity(market.lending);
  const lenderPools = useLenderPools(market.lending, user);
  const borrowerLoans = useBorrowerLoans(market.lending, user);
  const streams = useHeldStreams(user);

  const normalizedUser = user?.toLowerCase();
  const userLiquidity = liquidity.liquidity.filter(
    (position) =>
      position.market.toLowerCase() === market.market.toLowerCase() &&
      Boolean(normalizedUser) &&
      position.lender.toLowerCase() === normalizedUser,
  );
  const userPools = lenderPools.pools.filter(
    ({ pool }) => pool.market.toLowerCase() === market.market.toLowerCase(),
  );
  const userLoans = borrowerLoans.loans.filter(
    ({ pool }) => pool.market.toLowerCase() === market.market.toLowerCase(),
  );
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const isLoading =
    liquidity.isLoading || lenderPools.isLoading || borrowerLoans.isLoading || streams.isLoading;
  const hasError =
    liquidity.error || lenderPools.error || borrowerLoans.error || streams.error;

  if (isLoading) {
    return <div className="empty mono">LOADING</div>;
  }

  if (hasError) {
    return (
      <div className="empty mono status-negative">
        UNABLE TO LOAD POSITIONS
      </div>
    );
  }

  const hasLending = userLiquidity.length > 0 || userPools.length > 0;
  const hasBorrowing = userLoans.length > 0;
  const hasStreams = eligibleStreams.length > 0;

  if (!hasLending && !hasBorrowing && !hasStreams) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {hasLending ? (
        <div className="position-group">
          <div className="label mono">LENDING</div>
          <table>
            <tbody>
              {userLiquidity.map((position) => (
                <tr key={`liquidity-${position.id}`}>
                  <td className="mono">{formatId(position.id)}</td>
                  <td className="mono">{formatTokenAmount(position.availableLiquidity, "wstETH")}</td>
                  <td>
                    <button
                      className="button button-gold mono"
                      type="button"
                      onClick={() => onAction({ type: "withdraw", positionId: position.id })}
                    >
                      WITHDRAW
                    </button>
                  </td>
                </tr>
              ))}
              {userPools.map((pool) => (
                <tr key={`pool-${pool.pool.id}`}>
                  <td className="mono">POOL {formatId(pool.pool.id)}</td>
                  <td className="mono">{formatTokenAmount(pool.claimable, "ovrflo")}</td>
                  <td>
                    <button
                      className="button button-gold mono"
                      type="button"
                      disabled={pool.claimable === 0n}
                      onClick={() => onAction({ type: "claim_share", positionId: pool.pool.id })}
                    >
                      CLAIM SHARE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasBorrowing ? (
        <div className="position-group">
          <div className="label mono">BORROWING</div>
          <table>
            <tbody>
              {userLoans.map(({ loan, pool }) => (
                <tr key={`loan-${loan.id}`}>
                  <td className="mono">{formatId(loan.id)}</td>
                  <td className="mono">{formatTokenAmount(loanOutstanding(loan), "ovrflo")}</td>
                  <td className="mono">{isLoanOpen(loan) ? "OPEN" : "SETTLED"}</td>
                  <td className="mono">{formatAddress(pool.market)}</td>
                  <td>
                    <button
                      className="button button-cyan mono"
                      type="button"
                      disabled={loanOutstanding(loan) === 0n}
                      onClick={() => onAction({ type: "repay", loanId: loan.id })}
                    >
                      REPAY
                    </button>
                    <button
                      className="button button-cyan mono"
                      type="button"
                      disabled={loan.closed}
                      onClick={() => onAction({ type: "close", loanId: loan.id })}
                    >
                      CLOSE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasStreams ? (
        <div className="position-group">
          <div className="label mono">STREAMS</div>
          <table>
            <tbody>
              {eligibleStreams.map((stream) => (
                <tr key={`stream-${stream.streamId}`}>
                  <td className="mono">{formatId(stream.streamId)}</td>
                  <td className="mono">{formatTokenAmount(stream.withdrawable, "ovrflo")}</td>
                  <td>
                    <button
                      className="button button-gold mono"
                      type="button"
                      onClick={() => onAction({ type: "claim_stream", streamId: stream.streamId })}
                    >
                      CLAIM
                    </button>
                    <button
                      className="button button-cyan mono"
                      type="button"
                      onClick={() => onAction({ type: "borrow", streamId: stream.streamId })}
                    >
                      BORROW
                    </button>
                    <button
                      className="button button-cyan mono"
                      type="button"
                      onClick={() => onAction({ type: "sell", streamId: stream.streamId })}
                    >
                      SELL NOW
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
