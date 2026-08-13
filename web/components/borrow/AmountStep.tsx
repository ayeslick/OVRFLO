"use client";

import { AmountField } from "@/components/kit/AmountField";
import { belowMinimumCopy } from "@/lib/errors";
import "./borrow.css";

export function AmountStep({
  value,
  unit,
  error,
  onChange,
  onMax,
}: {
  value: string;
  unit: string;
  error?: string;
  onChange: (next: string) => void;
  onMax: () => void;
}) {
  return (
    <div data-ui="UI-BORROW-AMOUNT">
      <AmountField
        id="borrow-amount"
        label="BORROW AMOUNT"
        value={value}
        unit={unit}
        error={error}
        onChange={onChange}
        onMax={onMax}
      />
    </div>
  );
}

export function amountErrorCopy(kind: "malformed" | "below-minimum" | "above-cap" | "fill-floor"): string {
  if (kind === "malformed") return "Enter a valid amount.";
  if (kind === "above-cap") return "This amount is above the stream-derived maximum.";
  if (kind === "fill-floor") return belowMinimumCopy("fill-floor");
  return belowMinimumCopy("fill-floor");
}
