"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CreateChoices, CreateStage, StageVisibility } from "@/lib/create-stages";
import { blockingCopy, visibleDecisionStages } from "@/lib/create-stages";
import { rememberOpener, restoreOpenerOrHeading } from "@/lib/surface-focus";
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
  onBack,
  children,
}: {
  stage: CreateStage;
  visibility: StageVisibility;
  choices: CreateChoices;
  labels: Partial<Record<keyof CreateChoices, string>>;
  compact: boolean;
  onBack?: () => void;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const backPendingRef = useRef(false);

  useEffect(() => {
    const heading = headingRef.current;
    if (backPendingRef.current) {
      backPendingRef.current = false;
      restoreOpenerOrHeading(openerRef.current, heading);
      return;
    }
    heading?.focus();
  }, [stage]);

  const block = blockingCopy(stage, visibility);
  const progress = visibleProgress(visibility);
  const completed = progress.filter((row) => row !== stage);

  return (
    <div className="create-stage" data-compact={compact ? "true" : "false"} data-stage={stage}>
      <ol
        className={compact ? "create-stage-progress kit-vh" : "create-stage-summary"}
        aria-label="Create progress"
      >
        {(compact ? progress : completed).map((row) => (
          <li key={row} aria-current={row === stage ? "step" : undefined}>
            <span>{STAGE_TITLE[row]}</span>
            <strong>{row === stage ? "Current" : summaryValue(row, choices, labels)}</strong>
          </li>
        ))}
      </ol>
      {onBack ? (
        <button
          type="button"
          className="create-stage-back"
          onClick={() => {
            backPendingRef.current = true;
            onBack();
          }}
        >
          Back
        </button>
      ) : null}
      <section
        className="create-stage-decision"
        onClick={() => {
          openerRef.current = rememberOpener();
        }}
      >
        <h2
          ref={headingRef}
          tabIndex={-1}
          data-surface-heading
          className="create-stage-heading kit-surface-heading"
        >
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

function visibleProgress(visibility: StageVisibility): CreateStage[] {
  return [...visibleDecisionStages(visibility), "review"];
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
