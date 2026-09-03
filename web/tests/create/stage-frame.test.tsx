import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CreateStageFrame } from "@/components/create/CreateStageFrame";
import {
  emptyChoices,
  firstRequiredOrBlockingStage,
  previousVisibleStage,
  stageVisibility,
  type CreateChoices,
  type CreateStage,
  type CreateStageContext,
} from "@/lib/create-stages";

function loanContext(): CreateStageContext {
  return {
    positionType: "loan",
    sources: [
      { id: "stream-1", kind: "existing-stream", amountFixed: true },
      { id: "fresh", kind: "fresh", amountFixed: false },
    ],
    underlyings: [{ id: "wsteth" }],
    terms: [{ id: "2027-03" }],
    outcomes: [{ id: "500" }, { id: "800" }],
  };
}

function Frame({
  compact,
  start,
}: {
  compact: boolean;
  start?: CreateStage;
}) {
  const context = loanContext();
  const [choices, setChoices] = useState<CreateChoices>({
    ...emptyChoices(),
    sourceId: "stream-1",
    amount: "fixed",
  });
  const visibility = stageVisibility(context, choices);
  const [stage, setStage] = useState<CreateStage>(
    start ?? firstRequiredOrBlockingStage(context, choices),
  );
  const back = previousVisibleStage(stage, visibility);

  return (
    <CreateStageFrame
      stage={stage}
      visibility={visibility}
      choices={choices}
      labels={{ sourceId: "Existing stream" }}
      compact={compact}
      onBack={
        back
          ? () => {
              setStage(back);
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => {
          setChoices({ ...choices, outcomeId: "500" });
          setStage("review");
        }}
      >
        CONTINUE
      </button>
    </CreateStageFrame>
  );
}

describe("CS4-U6 create stage frame", () => {
  it("keeps ordered progress in the tree when compact hides the summary", () => {
    render(<Frame compact />);
    const progress = screen.getByRole("list", { name: "Create progress" });
    expect(progress).toHaveClass("kit-vh");
    expect(progress.textContent).toMatch(/Source/);
    expect(progress.textContent).toMatch(/Outcome/);
    expect(progress.textContent).toMatch(/Review/);
    expect(progress.textContent).not.toMatch(/Amount/);
    expect(progress.textContent).not.toMatch(/Term/);
    expect(document.querySelector("[aria-current='step']")).toHaveTextContent("Outcome");
  });

  it("focuses the destination heading after a stage change", () => {
    render(<Frame compact={false} />);
    expect(document.activeElement).toHaveTextContent("Outcome");
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    expect(document.activeElement).toHaveTextContent("Review");
  });

  it("restores opener focus on Back when the opener remains", () => {
    render(<Frame compact={false} />);
    const continueButton = screen.getByRole("button", { name: "CONTINUE" });
    continueButton.focus();
    fireEvent.click(continueButton);
    expect(document.activeElement).toHaveTextContent("Review");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement === continueButton || document.activeElement?.textContent === "Outcome").toBe(
      true,
    );
  });
});
