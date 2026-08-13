"use client";

import { AmountField } from "@/components/kit/AmountField";
import { formatTokenAmount } from "@/lib/format";
import { MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";
import "./supply.css";

export function AmountStep({
  value,
  unit,
  error,
  maxDisabled,
  minLiquidity = MIN_LIQUIDITY_AMOUNT,
  onChange,
  onMax,
}: {
  value: string;
  unit: string;
  error?: string;
  maxDisabled?: boolean;
  minLiquidity?: bigint;
  onChange: (next: string) => void;
  onMax: () => void;
}) {
  return (
    <div data-ui="UI-SUPPLY-AMOUNT">
      <AmountField
        id="supply-amount"
        label="SUPPLY AMOUNT"
        value={value}
        unit={unit}
        error={error}
        maxDisabled={maxDisabled}
        onChange={onChange}
        onMax={onMax}
      />
      <p className="supply-hint">
        MINIMUM {formatTokenAmount(minLiquidity, unit)} · MUST BE UNIT-ALIGNED
      </p>
    </div>
  );
}
