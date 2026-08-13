"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseFlowDecision,
  revalidateDecision,
  writeFlowDecisionSearch,
  type FlowDecision,
} from "@/lib/flow-history";

export function useFlowDecisionHistory(options: {
  hasFrozenSnapshot: boolean;
  hasSelection: boolean;
}): {
  decision: FlowDecision;
  go: (next: FlowDecision, mode?: "push" | "replace") => void;
} {
  const [decision, setDecision] = useState<FlowDecision>("select");
  const frozenRef = useRef(options.hasFrozenSnapshot);
  const selectionRef = useRef(options.hasSelection);
  frozenRef.current = options.hasFrozenSnapshot;
  selectionRef.current = options.hasSelection;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const parsed = parseFlowDecision(new URLSearchParams(window.location.search).get("step"));
      setDecision(revalidateDecision(parsed, frozenRef.current, selectionRef.current));
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  const go = useCallback((next: FlowDecision, mode: "push" | "replace" = "push") => {
    if (typeof window === "undefined") {
      setDecision(next);
      return;
    }
    const search = writeFlowDecisionSearch(window.location.search, next);
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setDecision(next);
  }, []);

  return { decision, go };
}
