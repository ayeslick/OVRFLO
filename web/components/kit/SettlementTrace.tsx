"use client";

import "./kit.css";

export type TraceStepState = "done" | "active" | "pending" | "skipped" | "error";

export type TraceStep = {
  id: string;
  label: string;
  state: TraceStepState;
};

export function SettlementTrace({
  steps,
  label = "SETTLEMENT",
}: {
  steps: readonly TraceStep[];
  label?: string;
}) {
  const shown = steps.filter((step) => step.state !== "skipped");

  return (
    <div className="kit-trace" data-trace="settlement">
      <span className="kit-trace-title">{label}</span>
      {shown.map((step, index) => (
        <span key={step.id} style={{ display: "contents" }}>
          {index > 0 ? <span className="kit-trace-rule" aria-hidden="true" /> : null}
          <span className="kit-trace-step" data-state={step.state} data-step={step.id}>
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}
