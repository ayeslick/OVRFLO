"use client";

import "./kit.css";

export type ReceiptKind = "permission" | "action";
export type ReceiptState =
  | "current"
  | "ghosted"
  | "skipped"
  | "frozen-review"
  | "wallet-pending"
  | "chain-pending"
  | "confirmed"
  | "reverted"
  | "error";

export type ReceiptLine = {
  key: string;
  value: string;
};

export function Receipt({
  kind,
  state,
  lines,
  note,
}: {
  kind: ReceiptKind;
  state: ReceiptState;
  lines: readonly ReceiptLine[];
  note?: string;
}) {
  if (state === "skipped") return null;
  const heading = kind === "permission" ? "PERMISSION RECEIPT" : "ACTION RECEIPT";
  return (
    <div className="kit-receipt" data-kind={kind} data-state={state}>
      <div className="kit-receipt-title">
        <span>{heading}</span>
        <em>{note ?? "ALWAYS TOKEN-EXACT"}</em>
      </div>
      {lines.map((line) => (
        <div className="kit-receipt-line" key={line.key}>
          <span className="kit-receipt-key">{line.key}</span>
          <span className="kit-receipt-value">{line.value}</span>
        </div>
      ))}
    </div>
  );
}
