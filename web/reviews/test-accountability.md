# Test accountability

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
