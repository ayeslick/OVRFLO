import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalErrorBoundary } from "@/components/ModalErrorBoundary";

function Bomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error("boom from body");
  return <div>FORM BODY OK</div>;
}

describe("ModalErrorBoundary", () => {
  it("swaps a throwing body for the fallback and recovers via onReset remount", () => {
    // Parent mirrors ActionModal's contract: onReset bumps a key that also
    // disarms the bomb, so TRY AGAIN remounts a healthy subtree.
    function Harness() {
      const [reloadKey, setReloadKey] = useState(0);
      return (
        <ModalErrorBoundary onReset={() => setReloadKey((key) => key + 1)}>
          <Bomb key={reloadKey} armed={reloadKey === 0} />
        </ModalErrorBoundary>
      );
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    expect(screen.getByTestId("modal-error-boundary")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("boom from body");

    fireEvent.click(screen.getByTestId("modal-error-boundary-reset"));
    expect(screen.getByText("FORM BODY OK")).toBeInTheDocument();
    expect(screen.queryByTestId("modal-error-boundary")).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ModalErrorBoundary>
        <div>FORM BODY OK</div>
      </ModalErrorBoundary>,
    );
    expect(screen.getByText("FORM BODY OK")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
