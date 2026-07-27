"use client";

import { useEffect } from "react";

export function useEscapeKey(onClose: () => void, enabled = true) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && enabled) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, onClose]);
}
