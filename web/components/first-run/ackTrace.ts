import type { TraceStep } from "@/components/kit/SettlementTrace";

export const ACKNOWLEDGE_RISK_STEP_ID = "acknowledge-risk";
export const ACKNOWLEDGE_RISK_STEP_LABEL = "ACKNOWLEDGE RISK";

export type AcknowledgmentGate = {
  acknowledged: boolean;
  ready: boolean;
};

/**
 * Insert `ACKNOWLEDGE RISK` as the first SETTLEMENT stage on the wallet's
 * first write. Omit it forever after acknowledge(). Never a read gate.
 *
 * U12 adopts this when composing traces. This unit does not rewrite the
 * executor — wiring into live write flows is a remaining gap until then.
 */
export function withAcknowledgeRiskStep(
  steps: readonly TraceStep[],
  gate: AcknowledgmentGate,
): TraceStep[] {
  if (!gate.ready || gate.acknowledged) return [...steps];
  return [
    { id: ACKNOWLEDGE_RISK_STEP_ID, label: ACKNOWLEDGE_RISK_STEP_LABEL, state: "active" },
    ...steps.map((step) => (step.state === "active" ? { ...step, state: "pending" as const } : step)),
  ];
}

export function needsAcknowledgeRisk(gate: AcknowledgmentGate): boolean {
  return gate.ready && !gate.acknowledged;
}
