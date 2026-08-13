"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionExecutionResult,
  ExecutionPlan,
} from "@/lib/action-runtime";
import type { ActionIdentity } from "@/lib/actions/types";
import {
  reconcileQueuedTx,
  type ClaimAllRowReconciliation,
  type QueuedTx,
} from "@/lib/claim-all";

export type QueuePauseReason =
  | "completeness"
  | "agreement"
  | "hydration"
  | "account"
  | "chain";

export type QueueInvariant =
  | { ready: true }
  | { ready: false; reason: QueuePauseReason };

export type QueueRowStatus =
  | "pending"
  | "preparing"
  | "confirmed"
  | "skipped"
  | "needs-review"
  | "paused"
  | "refresh-failed"
  | "failed";

export type QueueRow = {
  tx: QueuedTx;
  status: QueueRowStatus;
  replacement?: QueuedTx;
};

export type QueueOutcome =
  | "idle"
  | "in_progress"
  | "complete_success"
  | "complete_with_skips"
  | "partial_completion";

export type ClaimAllRowBuild =
  | { status: "ready"; plan: ExecutionPlan }
  | Extract<ClaimAllRowReconciliation, { status: "needs-review" | "skipped" }>;

export type ClaimAllQueueExecutor = {
  confirm: (plan: ExecutionPlan) => Promise<ActionExecutionResult>;
  retryRefresh: () => Promise<ActionExecutionResult | null>;
};

export type UseTxQueueOptions = {
  identity: ActionIdentity | null;
  invariants: () => QueueInvariant;
  rebuild: (
    tx: QueuedTx,
    identity: ActionIdentity,
  ) => Promise<ClaimAllRowBuild>;
  executor: ClaimAllQueueExecutor;
};

function txGroupKey(tx: QueuedTx): string {
  return tx.kind === "pool-claims"
    ? `pool:${tx.lending.toLowerCase()}`
    : `stream:${tx.streamId}`;
}

function txCoverageKeys(tx: QueuedTx): string[] {
  return tx.kind === "pool-claims"
    ? tx.claims.map(
        (claim) => `pool:${tx.lending.toLowerCase()}:${claim.loanId}`,
      )
    : [`stream:${tx.streamId}`];
}

function withoutCompleted(
  tx: QueuedTx,
  completed: ReadonlySet<string>,
): QueuedTx | null {
  if (tx.kind === "stream-claim") {
    const coverageKey = txCoverageKeys(tx)[0];
    if (coverageKey === undefined) return tx;
    return completed.has(coverageKey) ? null : tx;
  }
  const claims = tx.claims.filter(
    (claim) =>
      !completed.has(`pool:${tx.lending.toLowerCase()}:${claim.loanId}`),
  );
  return claims.length === 0 ? null : { ...tx, claims };
}

/**
 * Sequential Claim All orchestration over U6's executor.
 *
 * This hook owns queue history and execution-time guards only. It never
 * simulates, signs, waits for receipts, or refreshes data itself. A row becomes
 * confirmed only when the injected executor resolves `success`, which is after
 * its successful receipt and critical refresh. Every unsent row is rebuilt
 * immediately before that executor is allowed to prompt the wallet.
 */
export function useTxQueue(options: UseTxQueueOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const identityRef = useRef(options.identity);
  identityRef.current = options.identity;
  const queueOwner = useRef<ActionIdentity | null>(null);
  const generation = useRef(0);
  const rowsRef = useRef<QueueRow[]>([]);
  const refreshFailure = useRef<{
    index: number;
    result: Extract<ActionExecutionResult, { status: "refresh_failed" }>;
  } | null>(null);
  const processAtRef = useRef<
    ((index: number, run: number) => Promise<void>) | null
  >(null);

  const [rows, setRowsState] = useState<QueueRow[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<QueuePauseReason | null>(null);
  const [error, setError] = useState<unknown>(null);

  const setRows = useCallback(
    (next: QueueRow[] | ((current: QueueRow[]) => QueueRow[])) => {
      const resolved =
        typeof next === "function" ? next(rowsRef.current) : next;
      rowsRef.current = resolved;
      setRowsState(resolved);
    },
    [],
  );

  const updateRow = useCallback(
    (
      index: number,
      status: QueueRowStatus,
      replacement?: QueuedTx,
    ) => {
      setRows((current) =>
        current.map((row, rowIndex) => {
          if (rowIndex !== index || row.status === "confirmed") return row;
          return {
            ...row,
            status,
            ...(replacement ? { replacement } : {}),
          };
        }),
      );
    },
    [setRows],
  );

  const pauseAt = useCallback(
    (index: number, reason: QueuePauseReason) => {
      updateRow(index, "paused");
      setPauseReason(reason);
      setPaused(true);
      setRunning(false);
    },
    [updateRow],
  );

  const invariantNow = useCallback((): QueueInvariant => {
    const owner = queueOwner.current;
    const current = identityRef.current;
    if (!owner || !current) return { ready: false, reason: "account" };
    if (owner.chainId !== current.chainId) return { ready: false, reason: "chain" };
    if (owner.account.toLowerCase() !== current.account.toLowerCase()) {
      return { ready: false, reason: "account" };
    }
    return optionsRef.current.invariants();
  }, []);

  const processAt = useCallback(
    async (index: number, run: number) => {
      if (generation.current !== run) return;
      const row = rowsRef.current[index];
      if (!row) {
        setRunning(false);
        return;
      }
      if (row.status === "confirmed" || row.status === "skipped") {
        await processAtRef.current?.(index + 1, run);
        return;
      }
      const beforeRebuild = invariantNow();
      if (!beforeRebuild.ready) {
        pauseAt(index, beforeRebuild.reason);
        return;
      }
      const identity = identityRef.current;
      if (!identity) {
        pauseAt(index, "account");
        return;
      }

      updateRow(index, "preparing");
      let rebuilt: ClaimAllRowBuild;
      try {
        rebuilt = await optionsRef.current.rebuild(row.tx, identity);
      } catch (nextError) {
        if (generation.current !== run) return;
        setError(nextError);
        updateRow(index, "failed");
        setRunning(false);
        return;
      }
      if (generation.current !== run) return;
      if (rebuilt.status === "skipped") {
        updateRow(index, "skipped");
        await processAtRef.current?.(index + 1, run);
        return;
      }
      if (rebuilt.status === "needs-review") {
        updateRow(index, "needs-review", rebuilt.replacement);
        setRunning(false);
        return;
      }

      // Re-check after the async rebuild and immediately before the executor
      // can reach a wallet prompt.
      const beforeExecutor = invariantNow();
      if (!beforeExecutor.ready) {
        pauseAt(index, beforeExecutor.reason);
        return;
      }

      let result: ActionExecutionResult;
      try {
        result = await optionsRef.current.executor.confirm(rebuilt.plan);
      } catch (nextError) {
        if (generation.current !== run) return;
        setError(nextError);
        updateRow(index, "failed");
        setRunning(false);
        return;
      }
      if (generation.current !== run) return;

      if (result.status === "success") {
        updateRow(index, "confirmed");
        await processAtRef.current?.(index + 1, run);
        return;
      }
      if (result.status === "refresh_failed") {
        refreshFailure.current = { index, result };
        setError(result.error);
        updateRow(index, "refresh-failed");
        setRunning(false);
        return;
      }
      if (result.status === "needs_review") {
        updateRow(index, "needs-review");
        setRunning(false);
        return;
      }
      if (result.status === "identity_changed") {
        const current = identityRef.current;
        pauseAt(
          index,
          queueOwner.current?.chainId !== current?.chainId ? "chain" : "account",
        );
        return;
      }
      if (
        result.status === "invalid" &&
        result.errors.length > 0 &&
        result.errors.every(
          (invalid) =>
            invalid.code === "nothing-claimable" ||
            invalid.code === "stream-not-owned",
        )
      ) {
        updateRow(index, "skipped");
        await processAtRef.current?.(index + 1, run);
        return;
      }
      setError("error" in result ? result.error : result);
      updateRow(index, "failed");
      setRunning(false);
    },
    [invariantNow, pauseAt, updateRow],
  );
  processAtRef.current = processAt;

  const start = useCallback(
    (plan: readonly QueuedTx[]) => {
      if (plan.length === 0 || !identityRef.current) return;
      const run = generation.current + 1;
      generation.current = run;
      queueOwner.current = identityRef.current;
      refreshFailure.current = null;
      setError(null);
      setPaused(false);
      setPauseReason(null);
      setRows(plan.map((tx) => ({ tx, status: "pending" })));
      setRunning(true);
      void processAtRef.current?.(0, run);
    },
    [setRows],
  );

  const resume = useCallback(
    (freshPlan: readonly QueuedTx[]) => {
      if (!identityRef.current) return;
      const run = generation.current + 1;
      generation.current = run;
      queueOwner.current = identityRef.current;
      setError(null);
      setPaused(false);
      setPauseReason(null);
      setRunning(true);

      const retainedRefresh = refreshFailure.current;
      if (retainedRefresh) {
        void (async () => {
          const invariant = invariantNow();
          if (!invariant.ready) {
            pauseAt(retainedRefresh.index, invariant.reason);
            return;
          }
          updateRow(retainedRefresh.index, "preparing");
          let result: ActionExecutionResult | null;
          try {
            result = await optionsRef.current.executor.retryRefresh();
          } catch (nextError) {
            if (generation.current !== run) return;
            setError(nextError);
            updateRow(retainedRefresh.index, "refresh-failed");
            setRunning(false);
            return;
          }
          if (generation.current !== run) return;
          if (result?.status === "success") {
            refreshFailure.current = null;
            updateRow(retainedRefresh.index, "confirmed");
            await processAtRef.current?.(retainedRefresh.index + 1, run);
          } else if (result?.status === "identity_changed") {
            pauseAt(retainedRefresh.index, "account");
          } else {
            if (result?.status === "refresh_failed") {
              refreshFailure.current = {
                index: retainedRefresh.index,
                result,
              };
              setError(result.error);
            }
            updateRow(retainedRefresh.index, "refresh-failed");
            setRunning(false);
          }
        })();
        return;
      }

      const history = rowsRef.current.filter(
        (row) => row.status === "confirmed" || row.status === "skipped",
      );
      const completed = new Set(history.flatMap((row) => txCoverageKeys(row.tx)));
      const current = freshPlan
        .map((tx) => withoutCompleted(tx, completed))
        .filter((tx): tx is QueuedTx => tx !== null);
      const currentByGroup = new Map(
        current.map((tx) => [txGroupKey(tx), tx] as const),
      );
      const matched = new Set<string>();
      const unresolved: QueueRow[] = [];
      let requiresReview = false;

      for (const row of rowsRef.current) {
        if (row.status === "confirmed" || row.status === "skipped") continue;
        const reviewed = withoutCompleted(row.tx, completed);
        if (!reviewed) continue;
        const group = txGroupKey(reviewed);
        const latest = currentByGroup.get(group) ?? null;
        if (latest) matched.add(group);
        const reconciliation = reconcileQueuedTx(reviewed, latest);
        if (reconciliation.status === "skipped") {
          unresolved.push({ tx: reviewed, status: "skipped" });
        } else if (reconciliation.status === "needs-review") {
          unresolved.push({
            tx: reviewed,
            status: "needs-review",
            replacement: reconciliation.replacement,
          });
          requiresReview = true;
        } else {
          unresolved.push({ tx: reviewed, status: "pending" });
        }
      }
      for (const tx of current) {
        if (matched.has(txGroupKey(tx))) continue;
        unresolved.push({ tx, status: "needs-review", replacement: tx });
        requiresReview = true;
      }

      setRows([...history, ...unresolved]);
      const firstPending = unresolved.findIndex((row) => row.status === "pending");
      if (requiresReview || firstPending === -1) {
        setRunning(false);
        return;
      }
      void processAtRef.current?.(history.length + firstPending, run);
    },
    [invariantNow, pauseAt, setRows, updateRow],
  );

  const acceptReview = useCallback(
    (reviewedPlan: readonly QueuedTx[]) => {
      if (!identityRef.current) return;
      const run = generation.current + 1;
      generation.current = run;
      queueOwner.current = identityRef.current;
      refreshFailure.current = null;
      setError(null);
      setPaused(false);
      setPauseReason(null);
      const history = rowsRef.current.filter(
        (row) => row.status === "confirmed" || row.status === "skipped",
      );
      const completed = new Set(history.flatMap((row) => txCoverageKeys(row.tx)));
      const pending = reviewedPlan
        .map((tx) => withoutCompleted(tx, completed))
        .filter((tx): tx is QueuedTx => tx !== null)
        .map((tx) => ({ tx, status: "pending" as const }));
      setRows([...history, ...pending]);
      if (pending.length === 0) {
        setRunning(false);
        return;
      }
      setRunning(true);
      void processAtRef.current?.(history.length, run);
    },
    [setRows],
  );

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const confirmedCount = rows.filter((row) => row.status === "confirmed").length;
  const terminal = rows.every(
    (row) => row.status === "confirmed" || row.status === "skipped",
  );
  const done = rows.length > 0 && terminal;
  const outcome: QueueOutcome =
    rows.length === 0
      ? "idle"
      : done
        ? rows.some((row) => row.status === "skipped")
          ? "complete_with_skips"
          : "complete_success"
        : confirmedCount > 0 &&
            rows.some((row) =>
              [
                "paused",
                "needs-review",
                "refresh-failed",
                "failed",
              ].includes(row.status),
            )
          ? "partial_completion"
          : "in_progress";

  return {
    rows,
    statusOf: (index: number) => rows[index]?.status ?? "pending",
    start,
    resume,
    acceptReview,
    running,
    paused,
    pauseReason,
    needsReview: rows.some((row) => row.status === "needs-review"),
    failed: rows.some(
      (row) => row.status === "failed" || row.status === "refresh-failed",
    ),
    error,
    inFlight: running,
    done,
    outcome,
  };
}
