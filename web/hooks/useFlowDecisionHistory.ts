"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateChoices, CreateStageContext } from "@/lib/create-stages";
import {
  isFlowCheckpoint,
  parseFlowDecision,
  revalidateDecision,
  serializeFlowDecision,
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
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("step");
      const parsed = parseFlowDecision(raw);
      const next = revalidateDecision(parsed, frozenRef.current, contextRef.current, choicesRef.current);
      if (isFlowCheckpoint(raw) || raw !== serializeFlowDecision(next)) {
        const search = writeFlowDecisionSearch(window.location.search, next);
        window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
      }
      setDecision(next);
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
