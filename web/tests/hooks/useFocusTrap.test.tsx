import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRef } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// R16/M-5. Two defects: the keydown listener was bound to the container, so it
// went deaf the moment focus left the panel; and initial focus was contested
// between the hook and its caller on the same commit.

function Panel({ initialFocus, withInput = true }: { initialFocus?: string; withInput?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, initialFocus);
  return (
    <div>
      <button type="button">outside-before</button>
      <div ref={ref} data-testid="panel">
        <button type="button">close</button>
        {withInput ? <input aria-label="amount" /> : null}
        <button type="button">submit</button>
      </div>
      <button type="button">outside-after</button>
    </div>
  );
}

describe("useFocusTrap (R16)", () => {
  it("honours the caller's initial-focus selector", () => {
    render(<Panel initialFocus="input" />);
    expect(document.activeElement).toBe(screen.getByLabelText("amount"));
  });

  it("falls back to the first focusable element when the selector matches nothing", () => {
    // SimpleActionForm renders no input; focus should land on the close button
    // rather than nowhere.
    render(<Panel initialFocus="input" withInput={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "close" }));
  });

  it("initial focus is deterministic across mounts", () => {
    const first = render(<Panel initialFocus="input" />);
    const firstFocused = document.activeElement?.getAttribute("aria-label");
    first.unmount();
    render(<Panel initialFocus="input" />);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(firstFocused);
  });

  it("wraps Tab from the last element back to the first", () => {
    render(<Panel initialFocus="input" />);
    const submit = screen.getByRole("button", { name: "submit" });
    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "close" }));
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    render(<Panel initialFocus="input" />);
    const close = screen.getByRole("button", { name: "close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" }));
  });

  it("reels focus back in after it has escaped the panel", () => {
    // The defect that made the trap inert: an element removed while focused, or
    // a trip out to browser chrome, left focus on <body>. Bound to the
    // container, the old listener never heard the next Tab at all.
    render(<Panel initialFocus="input" />);
    (document.activeElement as HTMLElement)?.blur();
    expect(document.body).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("panel").contains(document.activeElement)).toBe(true);
  });

  it("returns focus outside the panel to where it was on teardown", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Panel initialFocus="input" />);
    expect(document.activeElement).not.toBe(outside);

    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("ignores non-Tab keys", () => {
    render(<Panel initialFocus="input" />);
    const field = screen.getByLabelText("amount");
    field.focus();
    fireEvent.keyDown(document, { key: "a" });
    expect(document.activeElement).toBe(field);
  });
});
