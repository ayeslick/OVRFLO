"use client";

import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { needsAcknowledgeRisk } from "./ackTrace";
import "./first-run.css";
import "@/components/kit/kit.css";

export const RISK_GATE_BULLETS = [
  "Contracts and external protocols can fail.",
  "Market conditions can change before confirmation.",
  "Self-repaying means the pledged stream satisfies the loan and does not remove asset or contract risk.",
  "Unwrap depends on the live 1:1 wrap reserve.",
] as const;

export const FIXED_RETURN_RISK_SENTENCE =
  "Your fixed rate applies to capital when it is matched. Unfilled capital can wait and does not earn until used.";

/**
 * Risk gate after position-type selection and before the first wallet prompt.
 * Never shown on hub, collection, or detail.
 */
export function AcknowledgeRiskStep({
  path = "loan",
}: {
  path?: "loan" | "fixed";
}) {
  const acknowledgment = useAcknowledgment();
  if (!needsAcknowledgeRisk(acknowledgment)) return null;

  return (
    <section
      className="first-run-ack"
      data-ui="UI-REVIEW-ACKNOWLEDGE-RISK"
      data-control="UI-REVIEW-ACKNOWLEDGE-RISK"
      data-state="required"
      data-path={path}
    >
      <ul className="first-run-teaching">
        {RISK_GATE_BULLETS.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {path === "fixed" ? <li>{FIXED_RETURN_RISK_SENTENCE}</li> : null}
      </ul>
      <p>
        <a href="/risk/">VIEW FULL RISKS</a>
      </p>
      <button type="button" className="kit-action" data-variant="primary" onClick={acknowledgment.acknowledge}>
        I UNDERSTAND
      </button>
    </section>
  );
}
