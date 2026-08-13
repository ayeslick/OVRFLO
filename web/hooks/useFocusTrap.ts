"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside `ref` for as long as `active` holds, and restores it to
 * whatever was focused before on teardown.
 *
 * R16/M-5 fixed two defects here:
 *
 *  1. The keydown listener was attached to the container, so it only fired
 *     while focus was already inside the panel. Any route by which focus left
 *     — tabbing out to browser chrome and back, or an element being removed
 *     while focused, which happens constantly as buttons swap between
 *     APPROVE / SUPPLY / CLOSE — left the trap permanently inert and Tab then
 *     walked the page behind the scrim. It listens on `document` now and pulls
 *     focus back when it has escaped.
 *  2. Initial focus was contested: this hook focused the first focusable
 *     element while the caller focused the first input on the same commit, so
 *     which won depended on effect ordering. `initialFocus` gives the caller
 *     one explicit say, and the hook no longer guesses.
 *
 * @param initialFocus Selector for the element to focus on activation. Falls
 *        back to the first focusable element when absent or unmatched.
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  initialFocus?: string,
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const preferred = initialFocus ? container.querySelector<HTMLElement>(initialFocus) : null;
    const target = preferred ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;

      // Focus already escaped the panel — an element was removed while focused,
      // or the user tabbed out to browser chrome and back. Reel it in rather
      // than letting Tab continue through the page behind the scrim.
      if (!container.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // On `document`, not the container: a listener bound to the container stops
    // hearing anything the moment focus leaves it, which is exactly when the
    // trap is needed.
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, ref, initialFocus]);
}
