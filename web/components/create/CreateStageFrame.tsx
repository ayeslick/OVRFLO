"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CreateChoices, CreateStage, StageVisibility } from "@/lib/create-stages";
import { blockingCopy, visibleDecisionStages } from "@/lib/create-stages";
import "./create-stage.css";

const STAGE_TITLE: Record<CreateStage, string> = {
  source: "Source",
  underlying: "Underlying",
  amount: "Amount",
  term: "Term",
  outcome: "Outcome",
  review: "Review",
};

export function CreateStageFrame({
  stage,
  visibility,
  choices,
  labels,
  compact,
  children,
}: {
  stage: CreateStage;
  visibility: StageVisibility;
  choices: CreateChoices;
  labels: Partial<Record<keyof CreateChoices, string>>;
  compact: boolean;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
  }, [stage]);

  const block = blockingCopy(stage, visibility);
  const completed = visibleDecisionStages(visibility).filter((row) => row !== stage);

  return (
    <div className="create-stage" data-compact={compact ? "true" : "false"} data-stage={stage}>
      {!compact ? (
        <ol className="create-stage-summary" aria-label="Completed choices">
          {completed.map((row) => (
            <li key={row}>
              <span>{STAGE_TITLE[row]}</span>
              <strong>{summaryValue(row, choices, labels)}</strong>
            </li>
          ))}
        </ol>
      ) : null}
      <section className="create-stage-decision">
        <h2 ref={headingRef} tabIndex={-1} className="create-stage-heading">
          {STAGE_TITLE[stage]}
        </h2>
        {block ? (
          <p className="create-stage-block" data-ui={`UI-CREATE-BLOCK-${stage.toUpperCase()}`}>
            {block}
          </p>
        ) : (
          children
        )}
      </section>
    </div>
  );
}

export function restoreOpenerFocus(opener: HTMLElement | null) {
  opener?.focus();
}

function summaryValue(
  stage: CreateStage,
  choices: CreateChoices,
  labels: Partial<Record<keyof CreateChoices, string>>,
): string {
  if (stage === "source") return labels.sourceId ?? choices.sourceId ?? "—";
  if (stage === "underlying") return labels.underlyingId ?? choices.underlyingId ?? "—";
  if (stage === "amount") return labels.amount ?? choices.amount ?? "—";
  if (stage === "term") return labels.termId ?? choices.termId ?? "—";
  if (stage === "outcome") return labels.outcomeId ?? choices.outcomeId ?? "—";
  return "Review";
}
