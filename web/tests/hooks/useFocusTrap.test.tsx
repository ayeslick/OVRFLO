import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

function pressTab(target: Element, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

describe("useFocusTrap", () => {
  let container: HTMLDivElement;
  let outsideButton: HTMLButtonElement;
  let first: HTMLButtonElement;
  let middle: HTMLButtonElement;
  let last: HTMLButtonElement;

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
  });

  afterEach(() => {
    container.remove();
    outsideButton.remove();
  });

  it("focuses the first focusable element on activation", () => {
    renderHook(() => useFocusTrap({ current: container }, true));
    expect(document.activeElement).toBe(first);
  });

  it("does nothing when inactive", () => {
    outsideButton.focus();
    renderHook(() => useFocusTrap({ current: container }, false));
    expect(document.activeElement).toBe(outsideButton);
  });

  it("wraps Tab from the last element back to the first", () => {
    renderHook(() => useFocusTrap({ current: container }, true));
    last.focus();
    pressTab(container);
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first element back to the last", () => {
    renderHook(() => useFocusTrap({ current: container }, true));
    first.focus();
    pressTab(container, true);
    expect(document.activeElement).toBe(last);
  });

  it("does not steal focus on Tab presses in the middle of the trap", () => {
    renderHook(() => useFocusTrap({ current: container }, true));
    middle.focus();
    pressTab(container);
    expect(document.activeElement).toBe(middle);
  });

  it("ignores non-Tab key presses entirely", () => {
    renderHook(() => useFocusTrap({ current: container }, true));
    last.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the previously focused element on cleanup", () => {
    outsideButton.focus();
    const { unmount } = renderHook(() => useFocusTrap({ current: container }, true));
    expect(document.activeElement).toBe(first);
    unmount();
    expect(document.activeElement).toBe(outsideButton);
  });

  it("does nothing (no crash) when the container has no focusable elements", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    outsideButton.focus();
    renderHook(() => useFocusTrap({ current: empty }, true));
    expect(document.activeElement).toBe(outsideButton);
    empty.remove();
  });

  it("does nothing when the ref is not yet attached to a DOM node", () => {
    renderHook(() => useFocusTrap({ current: null }, true));
    // No throw, and no focus change — this is the "modal not mounted yet" case.
    expect(document.activeElement).not.toBeNull();
  });
});
