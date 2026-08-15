"use client";

import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import { formatTruncatedDecimal } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import { freshnessCaption } from "./SuppliedDetail";
import "./watch.css";

export function ClosedLoanDetail({
  loan,
  symbol,
  freshness,
  streamPresent = true,
  onSelectStream,
}: {
  loan: BorrowerLoanRow;
  symbol: string;
  freshness: Freshness;
  streamPresent?: boolean;
  onSelectStream: (streamId: bigint) => void;
}) {
  return (
    <article data-ui="UI-WATCH-CLOSED-DETAIL" data-region="settled-detail" data-state="settled">
      <div className="kit-hero">
        <span className="kit-hero-kicker">SETTLED</span>
        <p className="watch-hero-meta">LOAN #{loan.id.toString()}</p>
      </div>
      <button
        type="button"
        className="watch-back"
        onClick={() => onSelectStream(loan.streamId)}
      >
        {streamPresent
          ? `RETURNED STREAM #${loan.streamId.toString()}`
          : `STREAM #${loan.streamId.toString()} GONE`}
      </button>
      <dl className="watch-facts">
        <Fact label="OBLIGATION" value={`${formatTruncatedDecimal(loan.obligation, 18, 5)} ${symbol}`} />
        <Fact label="REPAID" value={`${formatTruncatedDecimal(loan.repaid, 18, 5)} ${symbol}`} />
        <Fact label="STREAM" value={`#${loan.streamId.toString()}`} />
      </dl>
      <p className="watch-freshness">{freshnessCaption(freshness)}</p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="watch-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
