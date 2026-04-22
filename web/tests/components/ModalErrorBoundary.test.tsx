/**
 * Tests: T-WEB-ERRBOUND-1..3
 *
 * ModalErrorBoundary is the R14 fence that keeps a useReadContracts /
 * usePublicClient / unexpected render throw inside NewOvrfloModal or
 * ClaimModal from escaping to app/error.tsx. It must:
 *   1. Render children unchanged when they don't throw.
 *   2. Catch a render-time throw and show the reset button.
 *   3. Unmount the error state when reset() is called so the next render
 *      is fresh — this is what makes "Try again" actually re-run the
 *      failing hook.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

import { ModalErrorBoundary } from "@/components/ModalErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("kaboom");
  }
  return <div data-testid="boom-ok">rendered ok</div>;
}

describe("ModalErrorBoundary", () => {
  it("renders children unchanged when no error is thrown", () => {
    render(
      <ModalErrorBoundary>
        <Boom shouldThrow={false} />
      </ModalErrorBoundary>
    );
    expect(screen.getByTestId("boom-ok")).toBeInTheDocument();
    expect(
      screen.queryByTestId("modal-error-boundary")
    ).not.toBeInTheDocument();
  });

  it("catches a render-time throw and renders the fallback with a reset button", () => {
    // React still logs caught boundary errors via console.error even
    // though the boundary swallows them; silence the noise for this test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ModalErrorBoundary>
        <Boom shouldThrow />
      </ModalErrorBoundary>
    );
    expect(screen.getByTestId("modal-error-boundary")).toBeInTheDocument();
    expect(
      screen.getByTestId("modal-error-boundary-reset")
    ).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("reset() re-renders the child tree so a fixed child recovers", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Host() {
      // Parent controls the throw state so onReset can flip it off,
      // mirroring how NewOvrfloModal will pass a key/refetch callback.
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <ModalErrorBoundary onReset={() => setShouldThrow(false)}>
          <Boom shouldThrow={shouldThrow} />
        </ModalErrorBoundary>
      );
    }

    render(<Host />);
    expect(screen.getByTestId("modal-error-boundary")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-error-boundary-reset"));

    expect(screen.getByTestId("boom-ok")).toBeInTheDocument();
    expect(
      screen.queryByTestId("modal-error-boundary")
    ).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
