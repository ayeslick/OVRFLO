"use client";

import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import type { TraceStep } from "@/components/kit/SettlementTrace";
import { needsAcknowledgeRisk, withAcknowledgeRiskStep } from "./ackTrace";

/**
 * Compose a write-flow SETTLEMENT trace with the one-shot ack stage.
 * Adopt from U12; this file does not insert into the executor.
 */
export function useAcknowledgeRiskTrace(steps: readonly TraceStep[]): {
  steps: TraceStep[];
  needsAcknowledgment: boolean;
  acknowledge: () => void;
} {
  const acknowledgment = useAcknowledgment();
  return {
    steps: withAcknowledgeRiskStep(steps, acknowledgment),
    needsAcknowledgment: needsAcknowledgeRisk(acknowledgment),
    acknowledge: acknowledgment.acknowledge,
  };
}
