import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// fireEvent.keyDown (re-exported by @testing-library/react, already a
// devDependency, and act()-wrapped) instead of a hand-rolled
// `new KeyboardEvent(...) + dispatchEvent(...)` — see
// docs/solutions/best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md.
// It returns the same boolean as the underlying `dispatchEvent` call:
// `false` if the event was cancelable and something called
// `preventDefault()`, `true` otherwise — the one observable that
// distinguishes "the trap intercepted Tab" from "it didn't" in jsdom, which
// never actually moves focus on a real Tab keydown itself.
function pressTab(target: Element, shiftKey = false) {
  return fireEvent.keyDown(target, { key: "Tab", shiftKey });
}

describe("useFocusTrap", () => {
  let container: HTMLDivElement;
  let outsideButton: HTMLButtonElement;
  let first: HTMLButtonElement;
  let middle: HTMLButtonElement;
  let last: HTMLButtonElement;
  let ref: { current: HTMLDivElement };

  beforeEach(() => {
    outsideButton = document.createElement("button");
    outsideButton.textContent = "outside";
    document.body.appendChild(outsideButton);

    container = document.createElement("div");
    first = document.createElement("button");
    first.textContent = "first";
    middle = document.createElement("button");
    middle.textContent = "middle";
    last = document.createElement("button");
    last.textContent = "last";
    container.append(first, middle, last);
    document.body.appendChild(container);
    // Hoisted once per test: `ref` is in the hook's effect dependency array,
    // so a fresh object literal per render would tear down and re-establish
    // the trap on any rerender() a future test might add.
    ref = { current: container };
  });

  afterEach(() => {
    container.remove();
    outsideButton.remove();
  });

  it("focuses the first focusable element on activation", () => {
    renderHook(() => useFocusTrap(ref, true));
    expect(document.activeElement).toBe(first);
  });

  it("does nothing when inactive", () => {
    outsideButton.focus();
    renderHook(() => useFocusTrap(ref, false));
    expect(document.activeElement).toBe(outsideButton);
  });

  it("wraps Tab from the last element back to the first, and prevents the default", () => {
    renderHook(() => useFocusTrap(ref, true));
    last.focus();
    const notPrevented = pressTab(last);
    expect(document.activeElement).toBe(first);
    expect(notPrevented).toBe(false);
  });

  it("wraps Shift+Tab from the first element back to the last, and prevents the default", () => {
    renderHook(() => useFocusTrap(ref, true));
    first.focus();
    const notPrevented = pressTab(first, true);
    expect(document.activeElement).toBe(last);
    expect(notPrevented).toBe(false);
  });

  it("does not steal focus or intercept Tab presses in the middle of the trap", () => {
    renderHook(() => useFocusTrap(ref, true));
    middle.focus();
    // jsdom never moves focus on Tab itself, so `activeElement` staying at
    // `middle` holds whether or not the hook is even running — the real
    // signal that the trap declined to intercept this keydown is the event
    // NOT being prevented (the wrap tests above pin the case where it is).
    const notPrevented = pressTab(middle);
    expect(document.activeElement).toBe(middle);
    expect(notPrevented).toBe(true);
  });

  it("ignores non-Tab key presses entirely", () => {
    renderHook(() => useFocusTrap(ref, true));
    last.focus();
    const notPrevented = fireEvent.keyDown(last, { key: "Enter" });
    expect(document.activeElement).toBe(last);
    expect(notPrevented).toBe(true);
  });

  it("restores focus to the previously focused element on cleanup", () => {
    outsideButton.focus();
    const { unmount } = renderHook(() => useFocusTrap(ref, true));
    expect(document.activeElement).toBe(first);
    unmount();
    expect(document.activeElement).toBe(outsideButton);
  });

  it("does nothing (no crash) when the container has no focusable elements", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    outsideButton.focus();
    const emptyRef = { current: empty };
    renderHook(() => useFocusTrap(emptyRef, true));
    expect(document.activeElement).toBe(outsideButton);
    // Exercises the keydown guard clause (`elements.length === 0`), not just
    // the mount-time no-op — this was the one uncovered line in the hook.
    const notPrevented = pressTab(empty);
    expect(notPrevented).toBe(true);
    empty.remove();
  });

  it("does nothing when the ref is not yet attached to a DOM node", () => {
    outsideButton.focus();
    const nullRef = { current: null as unknown as HTMLDivElement };
    renderHook(() => useFocusTrap(nullRef, true));
    // Asserts focus is unchanged from a known prior element — `activeElement
    // !== null` is not a real assertion here since jsdom falls back to
    // `document.body`, which is never null regardless of what the hook does.
    expect(document.activeElement).toBe(outsideButton);
  });
});
