"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateChoices, CreateStageContext } from "@/lib/create-stages";
import {
  parseFlowDecision,
  revalidateDecision,
  writeFlowDecisionSearch,
  type FlowDecision,
} from "@/lib/flow-history";

export function useFlowDecisionHistory(options: {
  hasFrozenSnapshot: boolean;
  context: CreateStageContext;
  choices: CreateChoices;
}): {
  decision: FlowDecision;
  go: (next: FlowDecision, mode?: "push" | "replace") => void;
} {
  const [decision, setDecision] = useState<FlowDecision>("source");
  const frozenRef = useRef(options.hasFrozenSnapshot);
  const contextRef = useRef(options.context);
  const choicesRef = useRef(options.choices);
  frozenRef.current = options.hasFrozenSnapshot;
  contextRef.current = options.context;
  choicesRef.current = options.choices;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const parsed = parseFlowDecision(new URLSearchParams(window.location.search).get("step"));
      setDecision(
        revalidateDecision(parsed, frozenRef.current, contextRef.current, choicesRef.current),
      );
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  useEffect(() => {
    setDecision((current) =>
      revalidateDecision(current, options.hasFrozenSnapshot, options.context, options.choices),
    );
  }, [options.choices, options.context, options.hasFrozenSnapshot]);

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
