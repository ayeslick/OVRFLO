"use client";

import type { Address } from "viem";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLenderPools } from "@/hooks/useLenderPools";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { ovrfloLendingAbi } from "@/lib/abis";
import { formatAddress, formatId, formatTokenAmount } from "@/lib/format";
import { isLoanOpen, loanOutstanding, MAX_UINT128 } from "@/lib/lending-math";
import { lendingKeys, streamKeys } from "@/lib/query-keys";
import type { Loan, MarketInfo } from "@/lib/types";

type Props = {
  market: MarketInfo | null;
  user?: Address;
  onSelectLoan: (loan: Loan) => void;
};

export function PositionPanels({ market, user, onSelectLoan }: Props) {
  const liquidity = useLendingLiquidity(market?.lending);
  const lenderPools = useLenderPools(market?.lending, user);
  const borrowerLoans = useBorrowerLoans(market?.lending, user);
  const streams = useHeldStreams(user);
  const tx = useWriteFlow([
    lendingKeys.liquidity(market?.lending),
    lendingKeys.lenderPools(market?.lending, user),
    lendingKeys.borrowerLoans(market?.lending, user),
    streamKeys.held(user),
  ]);
  const normalizedUser = user?.toLowerCase();
  const userLiquidity = liquidity.liquidity.filter(
    (position) =>
      (!market || position.market.toLowerCase() === market.market.toLowerCase()) &&
      Boolean(normalizedUser) &&
      position.lender.toLowerCase() === normalizedUser,
  );
  const userPools = lenderPools.pools.filter(
    ({ pool }) => !market || pool.market.toLowerCase() === market.market.toLowerCase(),
  );
  const userLoans = borrowerLoans.loans.filter(
    ({ pool }) => !market || pool.market.toLowerCase() === market.market.toLowerCase(),
  );

  return (
    <section className="section">
      <div className="panels">
        <div className="panel">
          <div className="panel-header">
            <div className="label mono">LENDING</div>
            <h3>Supply and claims</h3>
          </div>
          <div className="panel-body">
            {liquidity.isLoading || lenderPools.isLoading ? (
              <div className="empty mono">LOADING</div>
            ) : userLiquidity.length === 0 && userPools.length === 0 ? (
              <div className="empty mono">NO ACTIVE LENDING</div>
            ) : (
              <table>
                <tbody>
                  {userLiquidity.map((position) => (
                    <tr key={`liquidity-${position.id}`}>
                      <td className="mono">{formatId(position.id)}</td>
                      <td className="mono">{formatTokenAmount(position.availableLiquidity, "wstETH")}</td>
                      <td>
                        <button
                          className="button mono"
                          disabled={!market?.lending || tx.isSigning || tx.isConfirming}
                          type="button"
                          onClick={() => {
                            if (!market?.lending) return;
                            tx.writeContract({
                              address: market.lending,
                              abi: ovrfloLendingAbi,
                              functionName: "withdrawLiquidity",
                              args: [position.id],
                            });
                          }}
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
                          className="button mono"
                          disabled={!market?.lending || pool.claimable === 0n || tx.isSigning || tx.isConfirming}
                          type="button"
                          onClick={() => {
                            if (!market?.lending) return;
                            tx.writeContract({
                              address: market.lending,
                              abi: ovrfloLendingAbi,
                              functionName: "claimLoanPoolShare",
                              args: [pool.pool.id, MAX_UINT128],
                            });
                          }}
                        >
                          CLAIM SHARE
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="label mono">BORROWING</div>
            <h3>Loans and pledged streams</h3>
          </div>
          <div className="panel-body">
            {borrowerLoans.isLoading ? (
              <div className="empty mono">LOADING</div>
            ) : userLoans.length === 0 ? (
              <div className="empty mono">NO ACTIVE LOANS</div>
            ) : (
              <table>
                <tbody>
                  {userLoans.map(({ loan, pool }) => (
                    <tr key={`loan-${loan.id}`}>
                      <td>
                        <button className="button mono" type="button" onClick={() => onSelectLoan(loan)}>
                          {formatId(loan.id)}
                        </button>
                      </td>
                      <td className="mono">{formatTokenAmount(loanOutstanding(loan), "ovrflo")}</td>
                      <td className="mono">{isLoanOpen(loan) ? "OPEN" : "SETTLED"}</td>
                      <td className="mono">{formatAddress(pool.market)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="label mono">STREAMS</div>
            <h3>Held streams</h3>
          </div>
          <div className="panel-body">
            {streams.isLoading ? (
              <div className="empty mono">LOADING</div>
            ) : streams.streams.length === 0 ? (
              <div className="empty mono">NO HELD STREAMS</div>
            ) : (
              <table>
                <tbody>
                  {streams.streams.map((stream) => (
                    <tr key={`stream-${stream.streamId}`}>
                      <td className="mono">{formatId(stream.streamId)}</td>
                      <td className="mono">{formatTokenAmount(stream.withdrawable, "ovrflo")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
