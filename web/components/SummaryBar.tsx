interface Props {
  totalWithdrawable: string;
  activeCount: number;
  claimableCount: number;
}

export function SummaryBar({ totalWithdrawable, activeCount, claimableCount }: Props) {
  return (
    <div
      className="grid grid-cols-3 gap-0 border-2 border-[#000] bg-white shadow-[var(--shadow-hard-sm)]"
      data-testid="summary-bar"
    >
      <div className="flex flex-col items-center justify-center gap-1 border-r border-[#000] px-4 py-4 sm:py-5">
        <span className="nb-kicker text-black/40">Total Withdrawable</span>
        <span className="mono text-lg font-bold text-black sm:text-xl">
          {totalWithdrawable}
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-1 border-r border-[#000] px-4 py-4 sm:py-5">
        <span className="nb-kicker text-black/40">Active Streams</span>
        <span className="mono text-lg font-bold text-black sm:text-xl">
          {String(activeCount).padStart(2, "0")}
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-4 sm:py-5">
        <span className="nb-kicker text-black/40">Claimable</span>
        <span className="mono text-lg font-bold text-[#5dc0f5] sm:text-xl">
          {String(claimableCount).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
