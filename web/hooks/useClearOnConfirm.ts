"use client";

import { useEffect, useRef } from "react";

// R7/H-3: once a transaction confirms, its arguments are spent — leaving them
// in the field is what lets a second click resubmit the same action. Clearing
// is only safe because the form simultaneously renders CONFIRMED and a CLOSE
// button: an empty field on its own would be indistinguishable from a form the
// user never touched.
//
// Fires once per confirmation, not on every render while `isConfirmed` stays
// true — otherwise a user who starts typing their next amount in the same open
// modal would have it wiped out from under them.
export function useClearOnConfirm(isConfirmed: boolean, clear: () => void) {
  const handled = useRef(false);
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (!isConfirmed) {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    clearRef.current();
  }, [isConfirmed]);
}
