/**
 * Tests: R23 — modal a11y primitives.
 *
 * Covers focus-on-open, Escape-to-close, and Tab focus trap so these
 * behaviors can't regress silently.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useModalA11y } from "@/hooks/useModalA11y";

function Harness({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useModalA11y({ open, onClose });
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      {open ? (
        <div ref={ref} role="dialog" aria-modal="true" data-testid="dialog">
          <button type="button" data-testid="first">
            first
          </button>
          <button type="button" data-testid="middle">
            middle
          </button>
          <button type="button" data-testid="last">
            last
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe("useModalA11y", () => {
  it("focuses the first focusable element on open", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness open={true} onClose={onClose} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from last focusable back to the first", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness open={true} onClose={onClose} />);
    const last = getByTestId("last");
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Shift+Tab from first focusable back to the last", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness open={true} onClose={onClose} />);
    const first = getByTestId("first");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });
});
