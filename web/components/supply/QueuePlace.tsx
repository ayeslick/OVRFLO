"use client";

import { QueueBand, type QueueBandState } from "@/components/kit/QueueBand";
import { formatTokenAmount } from "@/lib/format";
import { queueFractions } from "./helpers";
import "./supply.css";

export function QueuePlace({
  ahead,
  amount,
  unit,
  state,
}: {
  ahead: bigint;
  amount: bigint;
  unit: string;
  state: QueueBandState;
}) {
  const fractions = queueFractions(ahead, amount);
  const valueText =
    state === "empty-ahead"
      ? `nothing ahead · ${formatTokenAmount(amount, unit)} this order`
      : `${formatTokenAmount(ahead, unit)} ahead · ${formatTokenAmount(amount, unit)} this order`;

  return (
    <div data-ui="UI-SUPPLY-QUEUE-BAND" data-state={state}>
      <QueueBand
        variant="queue"
        state={state}
        aheadFraction={fractions.ahead}
        selfFraction={fractions.self}
        valueText={valueText}
        aheadLabel="AHEAD"
        selfLabel="THIS ORDER"
      />
      <p className="supply-hint">Unfilled is withdrawable until filled. Queue place is an amount ahead, not a wait.</p>
    </div>
  );
}
