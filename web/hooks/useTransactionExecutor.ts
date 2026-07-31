"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  executionIdentity,
  retryCriticalRefresh,
  runActionExecution,
  type ActionExecutionResult,
  type ActionExecutionRuntime,
  type ExecutionPhase,
  type ExecutionPlan,
} from "@/lib/action-runtime";

type ExecutorStatus = "idle" | ExecutionPhase | ActionExecutionResult["status"];

type RegistryEntry = {
  promise: Promise<ActionExecutionResult>;
  state: "pending" | "retained-refresh-failure";
};

const executionRegistry = new Map<string, RegistryEntry>();
const MAX_RETAINED_REFRESH_FAILURES = 128;

function trimRegistry() {
  let retained = [...executionRegistry.values()].filter(
    (entry) => entry.state === "retained-refresh-failure",
  ).length;
  if (retained <= MAX_RETAINED_REFRESH_FAILURES) return;
  for (const [key, entry] of executionRegistry) {
    if (entry.state !== "retained-refresh-failure") continue;
    executionRegistry.delete(key);
    retained -= 1;
    if (retained <= MAX_RETAINED_REFRESH_FAILURES) return;
  }
}

function executeOnce(
  key: string,
  plan: ExecutionPlan,
  runtime: ActionExecutionRuntime,
  onPhase: (phase: ExecutionPhase) => void,
): Promise<ActionExecutionResult> {
  const existing = executionRegistry.get(key);
  if (existing) return existing.promise;

  const promise = runActionExecution(plan, runtime, onPhase).then((result) => {
    const current = executionRegistry.get(key);
    if (current?.promise !== promise) return result;
    if (result.status === "refresh_failed") {
      current.state = "retained-refresh-failure";
    } else {
      executionRegistry.delete(key);
    }
    trimRegistry();
    return result;
  });
  const entry: RegistryEntry = { promise, state: "pending" };
  executionRegistry.set(key, entry);
  return promise;
}

export function useTransactionExecutor(runtime: ActionExecutionRuntime) {
  const [status, setStatus] = useState<ExecutorStatus>("idle");
  const [result, setResult] = useState<ActionExecutionResult | null>(null);
  const activeKey = useRef<string | null>(null);
  const retryPromise = useRef<ReturnType<typeof retryCriticalRefresh> | null>(null);

  const confirm = useCallback(
    async (plan: ExecutionPlan) => {
      const key = executionIdentity(plan);
      const pending = activeKey.current
        ? executionRegistry.get(activeKey.current)
        : undefined;
      if (
        activeKey.current &&
        activeKey.current !== key &&
        pending?.state === "pending"
      ) {
        return pending.promise;
      }
      activeKey.current = key;
      setStatus("revalidating");
      const next = await executeOnce(key, plan, runtime, setStatus);
      if (activeKey.current !== key) return next;
      setResult(next);
      setStatus(next.status);
      return next;
    },
    [runtime],
  );

  const retryRefresh = useCallback(async () => {
    if (!result || result.status !== "refresh_failed") return result;
    if (retryPromise.current) return retryPromise.current;
    const pending = (async () => {
      setStatus("refreshing");
      const next = await retryCriticalRefresh(result, runtime);
      if (activeKey.current) {
        if (next.status === "refresh_failed") {
          executionRegistry.set(activeKey.current, {
            promise: Promise.resolve(next),
            state: "retained-refresh-failure",
          });
        } else if (next.status === "success") {
          executionRegistry.delete(activeKey.current);
        }
      }
      setResult(next);
      setStatus(next.status);
      return next;
    })();
    retryPromise.current = pending;
    try {
      return await pending;
    } finally {
      if (retryPromise.current === pending) retryPromise.current = null;
    }
  }, [result, runtime]);

  const reset = useCallback(() => {
    if (
      activeKey.current &&
      executionRegistry.get(activeKey.current)?.state === "retained-refresh-failure"
    ) {
      executionRegistry.delete(activeKey.current);
    }
    setResult(null);
    setStatus("idle");
    activeKey.current = null;
  }, []);

  const report = useCallback((next: ActionExecutionResult) => {
    setResult(next);
    setStatus(next.status);
  }, []);

  // An `invalid` result carries `errors`, not `error`; without surfacing it
  // here no consumer (userFacingError, useStaleRecovery's classifier) ever
  // sees it and a failed pre-submit rebuild dead-ends silently. Memoized so
  // the Error identity is stable per result — useStaleRecovery's effect
  // depends on it.
  const error = useMemo(() => {
    if (!result) return null;
    if ("error" in result) return result.error;
    if ("errors" in result && result.errors.length > 0) {
      return new Error(
        result.errors.map((entry) => `${entry.code}: ${entry.message}`).join("; "),
      );
    }
    return null;
  }, [result]);

  return {
    confirm,
    report,
    retryRefresh,
    reset,
    status,
    result,
    hash:
      result && "hash" in result
        ? result.hash
        : undefined,
    receipt:
      result && "receipt" in result
        ? result.receipt
        : undefined,
    error,
    isSigning: status === "signing" || status === "approving",
    isConfirming: status === "confirming",
    isRefreshing: status === "refreshing",
    isInFlight:
      status === "connecting" ||
      status === "revalidating" ||
      status === "approving" ||
      status === "simulating" ||
      status === "signing" ||
      status === "confirming" ||
      status === "refreshing",
    isConfirmed: status === "success",
    isReverted: status === "reverted",
    refreshFailed: status === "refresh_failed",
    needsReview: status === "needs_review",
    hasFailed:
      status === "invalid" ||
      status === "identity_changed" ||
      status === "authorization_failed" ||
      status === "simulation_failed" ||
      status === "rejected" ||
      status === "transport_failed" ||
      status === "reverted" ||
      status === "refresh_failed",
  };
}

export function clearTransactionExecutionRegistryForTests() {
  executionRegistry.clear();
}
