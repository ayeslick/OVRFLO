# Test accountability

## 2026-07-31 — U8 shared flow shell and modal split

Owner: Codex U8 implementation

- `tests/lib/discovery/shadow-adapters.test.ts`: moved the temporary
  `gatherLiquidity` bridge assertion from `ActionModal.tsx` to the extracted
  live `action-flow/BorrowFlow.tsx`. This is a path update caused by the U8
  composition split, not a relaxation: U9 still owns and must remove the
  legacy bridge.
- `tests/components/ActionModal.test.tsx`: added explicit coverage for every
  Borrow outcome notice, including polite atomic announcements and the
  no-range-flood invariant, plus write-contract assertions for the extracted
  claim/position/convert/repay routing paths.
- `tests/components/borrow-form.test.tsx`: added flow-level classifier coverage
  for source-read failure, pending route reads, terminal quote errors, partial
  fills, insufficient own-only depth, and true-zero depth. Existing tests still
  cover stale-route recovery and the truncated-enumeration warning separately;
  no legacy discovery or executor authority was replaced.

## 2026-07-30 — U1 fail-closed runtime and anchors

Owner: Codex U1 implementation

- `tests/lib/config.test.ts`: removed expectations that production silently
  accepts a zero factory, missing RPC, and placeholder Reown ID. The replacement
  assertions enforce the R1 fail-closed production contract while retaining an
  explicit local profile that Vercel production rejects.
- `tests/hooks/useWriteFlow.test.tsx`: changed the caller-chain assertion from
  preserving `chainId: 999` to enforcing configured chain ID 1. The former
  expectation pinned the exact R4 override vulnerability.
- Added deployment, RPC, CSP/prebuilt packaging, error-boundary, and prerender
  guard coverage. No existing safe assertion was relaxed or removed.

## 2026-07-30 — U6 single-action transaction executor

Owner: Codex U6 implementation

- `tests/hooks/useWriteFlow.test.tsx`: replaced tests for the legacy
  `useWriteContract`/receipt-hook forwarding and delayed Ponder retry with
  adapter-level proofs for simulate-then-submit identity, runtime chain
  enforcement, mined-revert classification, scoped critical refresh, and
  refresh-only recovery. The removed timer expectation pinned the superseded
  delayed-indexer convergence behavior prohibited by U6.
- `tests/hooks/useApprovalWriteFlows.test.tsx`: changed the busy-state harness
  from wagmi-hook call ordering to the executor-adapter boundary and added
  critical-refresh/refresh-failed blocking coverage.
- Added direct runtime, query-resource registry, and shared in-flight executor
  coverage. No safe receipt-status or zero-first fallback assertion was
  relaxed.
- `tests/lib/live-action-plan.test.ts`: covers all twelve single-action types
  through their U5 definitions, including pinned-block rebuilds, Borrow's
  temporary uncapped `gatherLiquidity` bridge plus direct hydration, and
  renewed review when calldata changes. This bridge changes transaction
  authority only; the legacy live discovery surfaces remain in place for U9.

## 2026-07-30 — U7 Claim All executor orchestration

Owner: Codex U7 implementation

- `tests/hooks/useTxQueue.test.tsx`: replaced the queue's private wagmi
  write/receipt mock with an injected U6 executor contract. The replacement
  preserves the same-commit account-change race and normal sequential advance
  proofs, and adds completeness/agreement/hydration pauses, grouped-row
  needs-review/skipped outcomes, immutable confirmations, and refresh-only
  retry. Direct receipt, exact-simulation, invalidation, and refresh behavior
  remain covered at their new owner in `useTransactionExecutor`,
  `action-runtime`, and `query-resource-registry` tests.
- `tests/components/claim-all-modal.test.tsx`: inserted the new fail-closed
  preflight-to-review transition before the existing frozen-review/fresh-submit
  assertions, and requires changed visible work to receive another explicit
  review.
- `tests/components/position-summary.test.tsx`: replaced the legacy expectation
  that the indexer-backed summary could proceed directly to `CONFIRM QUEUE`
  with the U7 fail-closed verifier-unavailable boundary. U9 owns replacing that
  shadow producer; individual verified recovery remains available.
- Added pure preflight/cache/reconciliation, source-progress UI, and concrete
  grouped U6 execution-plan coverage. No safe freshness assertion was relaxed.
