"use client";

import { QueueBand, type QueueBandState } from "@/components/kit/QueueBand";
import { formatTokenAmount } from "@/lib/format";
import { poolFractions } from "./quote";
import "./borrow.css";

export function PoolBand({
  draw,
  depth,
  unit,
  state,
}: {
  draw: bigint;
  depth: bigint;
  unit: string;
  state: QueueBandState;
}) {
  const { self } = poolFractions(draw, depth);
  const valueText =
    state === "empty-tick"
      ? `0 ${unit} depth at this tick`
      : state === "partial"
        ? `draw exceeds ${formatTokenAmount(depth, unit)} depth`
        : `${formatTokenAmount(draw, unit)} draw of ${formatTokenAmount(depth, unit)} depth`;

  return (
    <div data-ui="UI-BORROW-POOL-BAND" data-state={state}>
      <QueueBand
        variant="pool"
        state={state}
        selfFraction={self}
        valueText={valueText}
        aheadLabel="POOL"
        selfLabel="YOUR DRAW"
      />
    </div>
  );
}
