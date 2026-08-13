import type { TraceStep } from "@/components/kit/SettlementTrace";
import { formatTruncatedDecimal } from "@/lib/format";

export type WrapStage = "amount" | "ack" | "approve" | "wrap" | "pending" | "confirmed";
export type UnwrapStage = "amount" | "ack" | "unwrap" | "pending" | "confirmed";
export type StreamStage =
  | "market"
  | "amount"
  | "review"
  | "ack"
  | "approve-pt"
  | "approve-fee"
  | "deposit"
  | "pending"
  | "confirmed";
export type ClaimStage = "amount" | "ack" | "claim" | "pending" | "confirmed";

function step(id: string, label: string, state: TraceStep["state"]): TraceStep {
  return { id, label, state };
}

function mark(
  id: string,
  activeId: string,
  doneIds: ReadonlySet<string>,
): TraceStep["state"] {
  if (id === activeId) return "active";
  if (doneIds.has(id)) return "done";
  return "pending";
}

export function wrapTrace({
  underlyingSymbol,
  needsApprove,
  ackRequired,
  stage,
}: {
  underlyingSymbol: string;
  needsApprove: boolean;
  ackRequired: boolean;
  stage: WrapStage;
}): TraceStep[] {
  const active =
    stage === "pending" ? "wrap" : stage === "confirmed" ? "settled" : stage;
  const order = [
    "amount",
    ...(ackRequired ? (["ack"] as const) : []),
    ...(needsApprove ? (["approve"] as const) : []),
    "wrap",
    "settled",
  ];
  const activeIndex = order.indexOf(active);
  const done = new Set(order.filter((_, index) => index < activeIndex || stage === "confirmed"));
  if (stage === "confirmed") done.add("settled");
  return [
    step("amount", "AMOUNT", mark("amount", active, done)),
    ...(ackRequired
      ? [step("ack", "ACKNOWLEDGE RISK", mark("ack", active, done))]
      : []),
    ...(needsApprove
      ? [step("approve", `APPROVE ${underlyingSymbol}`, mark("approve", active, done))]
      : [step("approve", `APPROVE ${underlyingSymbol}`, "skipped")]),
    step("wrap", "WRAP", mark("wrap", active, done)),
    step("settled", "SETTLED", mark("settled", active, done)),
  ];
}

export function unwrapTrace({
  ackRequired,
  stage,
}: {
  ackRequired: boolean;
  stage: UnwrapStage;
}): TraceStep[] {
  const active =
    stage === "pending" ? "unwrap" : stage === "confirmed" ? "settled" : stage === "amount" ? "unwrap" : stage;
  const order = [
    ...(ackRequired ? (["ack"] as const) : []),
    "unwrap",
    "settled",
  ];
  const activeIndex = order.indexOf(active);
  const done = new Set(order.filter((_, index) => index < activeIndex || stage === "confirmed"));
  if (stage === "confirmed") done.add("settled");
  return [
    ...(ackRequired
      ? [step("ack", "ACKNOWLEDGE RISK", mark("ack", active, done))]
      : []),
    step("unwrap", "UNWRAP", mark("unwrap", active, done)),
    step("settled", "SETTLED", mark("settled", active, done)),
  ];
}

export function streamTrace({
  needsPt,
  needsFee,
  ackRequired,
  stage,
}: {
  needsPt: boolean;
  needsFee: boolean;
  ackRequired: boolean;
  stage: StreamStage;
}): TraceStep[] {
  const active =
    stage === "pending" || stage === "review"
      ? stage === "review"
        ? needsPt
          ? "approve-pt"
          : needsFee
            ? "approve-fee"
            : "deposit"
        : "deposit"
      : stage === "confirmed"
        ? "settled"
        : stage;
  const order = [
    "market",
    "amount",
    ...(ackRequired ? (["ack"] as const) : []),
    ...(needsPt ? (["approve-pt"] as const) : []),
    ...(needsFee ? (["approve-fee"] as const) : []),
    "deposit",
    "settled",
  ];
  const resolvedActive = order.includes(active) ? active : "deposit";
  const activeIndex = order.indexOf(resolvedActive);
  const done = new Set(order.filter((_, index) => index < activeIndex || stage === "confirmed"));
  if (stage === "confirmed") done.add("settled");
  return [
    step("market", "MARKET", mark("market", resolvedActive, done)),
    step("amount", "PT AMOUNT", mark("amount", resolvedActive, done)),
    ...(ackRequired
      ? [step("ack", "ACKNOWLEDGE RISK", mark("ack", resolvedActive, done))]
      : []),
    ...(needsPt
      ? [step("approve-pt", "APPROVE PT", mark("approve-pt", resolvedActive, done))]
      : [step("approve-pt", "APPROVE PT", "skipped")]),
    ...(needsFee
      ? [step("approve-fee", "APPROVE FEE", mark("approve-fee", resolvedActive, done))]
      : [step("approve-fee", "APPROVE FEE", "skipped")]),
    step("deposit", "DEPOSIT", mark("deposit", resolvedActive, done)),
    step("settled", "SETTLED", mark("settled", resolvedActive, done)),
  ];
}

export function claimTrace({
  ackRequired,
  stage,
}: {
  ackRequired: boolean;
  stage: ClaimStage;
}): TraceStep[] {
  const active =
    stage === "pending" ? "claim" : stage === "confirmed" ? "settled" : stage === "amount" ? "claim" : stage;
  const order = [
    ...(ackRequired ? (["ack"] as const) : []),
    "claim",
    "settled",
  ];
  const activeIndex = order.indexOf(active);
  const done = new Set(order.filter((_, index) => index < activeIndex || stage === "confirmed"));
  if (stage === "confirmed") done.add("settled");
  return [
    ...(ackRequired
      ? [step("ack", "ACKNOWLEDGE RISK", mark("ack", active, done))]
      : []),
    step("claim", "CLAIM PT", mark("claim", active, done)),
    step("settled", "SETTLED", mark("settled", active, done)),
  ];
}

export function depositCapCopy({
  capLimit,
  capRemaining,
  capExceeded,
  capReached,
}: {
  capLimit: bigint;
  capRemaining: bigint | null;
  capExceeded: boolean;
  capReached: boolean;
}): string {
  if (capRemaining === null) return "CAP UNLIMITED";
  const cap = formatTruncatedDecimal(capLimit, 18, 2);
  const remaining = formatTruncatedDecimal(capRemaining, 18, 2);
  if (capReached) return `DEPOSIT CAP ${cap} PT REACHED — REMAINING 0.00 PT`;
  if (capExceeded) return `DEPOSIT CAP ${cap} PT EXCEEDED — REMAINING ${remaining} PT`;
  return `DEPOSIT CAP ${cap} PT — REMAINING ${remaining} PT`;
}
