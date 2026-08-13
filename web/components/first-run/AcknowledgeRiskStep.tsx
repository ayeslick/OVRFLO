"use client";

import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { needsAcknowledgeRisk } from "./ackTrace";
import "./first-run.css";
import "@/components/kit/kit.css";

/**
 * UI-REVIEW-ACKNOWLEDGE-RISK body. U12 renders this beside the SETTLEMENT
 * trace on the first write. It records via useAcknowledgment and never
 * re-prompts. It does not gate reads. Not a protocol transaction.
 */
export function AcknowledgeRiskStep() {
  const acknowledgment = useAcknowledgment();
  if (!needsAcknowledgeRisk(acknowledgment)) return null;

  return (
    <section className="first-run-ack" data-control="UI-REVIEW-ACKNOWLEDGE-RISK" data-state="required">
      <p>
        One acknowledgment per wallet, before the first write. Reads stay open. The
        factual note is on <a href="/risk">/risk</a>.
      </p>
      <button type="button" className="kit-action" data-variant="primary" onClick={acknowledgment.acknowledge}>
        ACKNOWLEDGE RISK
      </button>
    </section>
  );
}
