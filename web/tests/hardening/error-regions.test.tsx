import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalErrorBoundary, RegionErrorBoundary } from "@/components/ModalErrorBoundary";

function Bomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error("feed failed");
  return <div>REGION OK</div>;
}

describe("region error boundaries", () => {
  it("contains a thrown render error to its panel", () => {
    function Harness() {
      const [key, setKey] = useState(0);
      return (
        <div>
          <div>SHELL CHROME</div>
          <RegionErrorBoundary region="watch-wall" onReset={() => setKey((value) => value + 1)}>
            <Bomb key={key} armed={key === 0} />
          </RegionErrorBoundary>
          <div>OTHER REGION OK</div>
        </div>
      );
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    expect(screen.getByText("SHELL CHROME")).toBeInTheDocument();
    expect(screen.getByText("OTHER REGION OK")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-ui", "UI-SHELL-REGION-BOUNDARY");
    expect(screen.getByRole("alert")).toHaveAttribute("data-region", "watch-wall");
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(screen.getByText("REGION OK")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("keeps flow-body crashes on the review boundary", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ModalErrorBoundary control="UI-REVIEW-ERROR-BOUNDARY">
        <Bomb armed />
      </ModalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-ui", "UI-REVIEW-ERROR-BOUNDARY");
    errorSpy.mockRestore();
  });
});
