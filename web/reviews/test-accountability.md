# Test accountability

The log of **why** test coverage changed. Coverage that disappears silently is the
failure this file exists to prevent: a rewrite drops a behavior, the suite stays
green, and nobody can later tell whether the behavior was retired on purpose or lost.

Catalog of what exists: `web/reviews/testing.md`. Who reviews a change:
`docs/maps/REVIEW.md`.

## When an entry is required

Write an entry when a test is **deleted**, **rewritten**, **weakened**, or
**skipped** — where *weakened* means the assertion now permits behavior it previously
rejected.

No entry is needed for: adding tests; tightening an assertion; renaming a test or file
with its assertions intact; fixture, mock, or formatting churn that changes no
assertion.

Unsure? Ask whether a future agent reading the diff could mistake this for lost
coverage. If yes, write the entry — it costs four lines.

## Review, and who does it

**An agent review approves an accountability entry.** Review runs through the skills
in `docs/maps/REVIEW.md` — `ce-code-review` for a diff that includes test changes.
There is no human sign-off step for routine test changes, and none may be added here:
the Owner's review surface is exactly the five escalation triggers in `REVIEW.md`.

Record the review as a reference, not as an approval signature — which skill ran, its
verdict, and the date. An entry written before review says `Review: pending`; the
reviewing pass fills it in.

An entry that is **itself** an escalation trigger — for instance, removing the last
test guarding a mapped invariant, or one whose replacement moves a trust domain —
says so in `Escalation:` and names the trigger. Everything else routes to review and
merges on a clean verdict.

## Entry template

Copy this. Every field is required; `Escalation:` may be `none`.

```markdown
## YYYY-MM-DD — <short title> (<unit / ticket / PR>)

**Author:** <implementing agent or person>
**Review:** <skill> → <verdict>, YYYY-MM-DD   (or: pending)
**Escalation:** none   (or: trigger <n> — <why>)

- `path/to/the.test.ts`: <deleted | rewritten | weakened | skipped>.
  **Reason:** <why the change was necessary — what in the system moved>
  **Covered now by:** <path(s) and the behavior each holds — or "nothing, because
  the behavior no longer exists", with the evidence for that claim>
```

`Reason` must name the change in the system, not the change in the test. "The module
under test was deleted" is a reason; "the test was failing" is not.

`Covered now by` must point at a behavior, not a filename alone. If coverage was
recorded green against a since-removed interface before deletion, say so and date it —
that is the evidence that nothing was lost.

> **Note on older entries below.** Entries before 2026-08-03 use `Owner:` for the
> implementing agent. That is the **author** field, not the human Owner, and not a
> sign-off. New entries use `Author:` to keep the two apart.

---

## 2026-08-12 — U1 foundation purge (ticket 01)

**Author:** worker implementing U1
**Review:** pending
**Escalation:** none

Old-book / old-ABI modules were deleted so the app compiles against the
v1-lite ABI. Coverage that belonged to that topology is retired with it;
watch-surface, flow, and executor re-anchor tests land in U7–U14.

- `web/tests/hooks/useLendingLiquidity.test.ts`: deleted.
  **Reason:** `useLendingLiquidity` was purged with the old liquidity-id book.
  **Covered now by:** later U6/U7 hook re-anchor; retired with old topology.
- `web/tests/hooks/useLoanBook.test.tsx`: deleted.
  **Reason:** `useLoanBook` was purged with the old loan-pool book.
  **Covered now by:** later U6/U7; retired with old topology.
- `web/tests/hooks/useProjectionSync.test.tsx`: deleted.
  **Reason:** `useProjectionSync` was purged with live-projection.
  **Covered now by:** later U6; retired with old topology.
- `web/tests/hooks/useClaimAllPreflight.test.tsx`: deleted.
  **Reason:** claim-all preflight hook was purged with the old claim-all UI.
  **Covered now by:** later U7/U10; retired with old topology.
- `web/tests/hooks/useHeldStreams.test.tsx`: deleted.
  **Reason:** `useHeldStreams` was purged with old stream discovery wiring.
  **Covered now by:** later U6/U7; retired with old topology.
- `web/tests/lib/demand.test.ts`: deleted.
  **Reason:** `lib/demand.ts` was purged with the old demand surface.
  **Covered now by:** later U5/U7; retired with old topology.
- `web/tests/lib/claim-all-execution.test.ts`: deleted.
  **Reason:** `claim-all-execution` was purged with the old claim-all path.
  **Covered now by:** later U10; retired with old topology.
- `web/tests/lib/discovery/lending-projection.test.ts`: deleted.
  **Reason:** lending-projection was purged with the old log-projection stack.
  **Covered now by:** later U6; retired with old topology.
- `web/tests/lib/discovery/live-projection.test.ts`: deleted.
  **Reason:** live-projection was purged with the old book.
  **Covered now by:** later U6; retired with old topology.
- `web/tests/lib/discovery/shadow-adapters.test.ts`: deleted.
  **Reason:** shadow adapters were purged with live-projection.
  **Covered now by:** later U6; retired with old topology.
- `web/tests/lib/live-action-plan.test.ts`: deleted.
  **Reason:** live-action-plan was stubbed for identifier purge, not rewritten
  (U6 owns the executor re-anchor). The old-book suite cannot compile.
  **Covered now by:** U6 executor tests; retired with old topology until then.
- `web/tests/components/markets-table.test.tsx`: deleted.
  **Reason:** `MarketsTable` was retired; watch UI is U7.
  **Covered now by:** U7 / U14; retired with old topology.
- `web/tests/components/position-cards.test.tsx`: deleted.
  **Reason:** `PositionList` was retired.
  **Covered now by:** U7; retired with old topology.
- `web/tests/components/position-summary.test.tsx`: deleted.
  **Reason:** `PositionSummary` was retired.
  **Covered now by:** U7; retired with old topology.
- `web/tests/components/claim-all-modal.test.tsx`: deleted.
  **Reason:** `ClaimAllModal` was retired.
  **Covered now by:** U10; retired with old topology.
- `web/tests/components/claim-all-preflight.test.tsx`: deleted.
  **Reason:** claim-all preflight UI was retired with the modal.
  **Covered now by:** U10; retired with old topology.
- `web/tests/components/ActionModal.test.tsx`: deleted.
  **Reason:** `ActionModal` and action-flow were purged as old-book UI.
  **Covered now by:** U8–U11 flow units; retired with old topology.
- `web/tests/components/borrow-form.test.tsx`: deleted.
  **Reason:** borrow form lived in retired action-flow.
  **Covered now by:** U9; retired with old topology.
- `web/tests/components/supply-form.test.tsx`: deleted.
  **Reason:** supply form lived in retired action-flow.
  **Covered now by:** U8; retired with old topology.
- `web/tests/components/deposit-cap.test.tsx`: deleted.
  **Reason:** deposit-cap UI lived in retired convert/action-flow.
  **Covered now by:** U10; retired with old topology.
- `web/tests/components/data-layer.test.tsx`: deleted.
  **Reason:** data-layer test targeted retired MarketsTable wiring.
  **Covered now by:** U7; retired with old topology.
- `web/tests/components/launch-scope.test.tsx`: deleted.
  **Reason:** launch-scope test targeted retired MarketsApp composition.
  **Covered now by:** U7 / U12; retired with old topology.
- `web/tests/components/ladder-keyboard.test.tsx`: deleted.
  **Reason:** `RateLadder` was retired.
  **Covered now by:** U4 kit / U8–U9; retired with old topology.
- `web/tests/components/market-detail-error-boundary.test.tsx`: deleted.
  **Reason:** `MarketDetail` was retired.
  **Covered now by:** U7; retired with old topology.
- `web/tests-live/parity-freeze.test.ts`: deleted.
  **Reason:** live-projection parity freeze cannot compile without the old
  projection stack and `nextLiquidityId`.
  **Covered now by:** U6 / U14; retired with old topology.
- `web/tests-live/reorg-freshness.test.ts`: deleted.
  **Reason:** reorg-freshness imported deleted live-projection.
  **Covered now by:** U6 / U14; retired with old topology.
- `web/tests/lib/lending-math.test.ts`: rewritten (dropped `loanPoolClaimable`
  / `poolExists` cases).
  **Reason:** those helpers were removed from `lending-math.ts` with the old
  pool ABI.
  **Covered now by:** nothing, because the helpers no longer exist.
- `web/tests/lib/positions.test.ts`: rewritten (dropped `adjustReceiptSummary`
  / `selectForMarket` cases).
  **Reason:** those helpers were removed from `positions.ts` with old events
  and `LoanPool`.
  **Covered now by:** nothing, because the helpers no longer exist; receipt
  parsing returns in U5/U6.
- `web/tests/hooks/useLending.test.ts`: rewritten to the four v1-lite reads.
  **Reason:** `nextLiquidityId` / `nextSaleListingId` / `MAX_ROUTE_IDS` left
  the contract.
  **Covered now by:** the same file against `aprMinBps` / `aprMaxBps` /
  `feeBps` / `nextLoanId`.
- `web/tests/lib/borrow.test.ts`: rewritten `borrowReceiptSummary` to the
  `Borrowed` event (`actualBorrow`).
  **Reason:** `BorrowerLoanPoolCreated` / `totalContributed` left the ABI.
  **Covered now by:** the same file against `Borrowed`.
- `web/tests/lib/abis.test.ts`: rewritten event-name pins to `Supplied` /
  `Borrowed`.
  **Reason:** `LiquidityCheckpoint` / `BorrowerLoanPoolCreated` left the ABI.
  **Covered now by:** the same file against v1-lite events.
- `web/tests/lib/actions.test.ts`: borrow call assertion now expects `borrow`
  rather than `createBorrowerLoanPool`.
  **Reason:** the action definition encodes the v1-lite function name.
  **Covered now by:** the same file; projected-route selection still asserted
  until U5/U6 rewrite the borrow snapshot.

## 2026-07-31 — U12 Ponder/Envio deletion (ticket 11)

Owner: Claude ticket-11 implementation

- `web/tests/lib/ponder.test.ts` and `web/tests/indexer/scope-guard.test.ts`:
  deleted with the modules they tested (`lib/ponder.ts`,
  `hooks/useIndexerSync.ts`, the Ponder runtime under `tools/ponder/`). Stream
  and demand discovery are covered at their new owners:
  `tests/lib/discovery/live-projection.test.ts` (verified-log projection),
  `tests/hooks/useHeldStreams.test.tsx`, `tests/hooks/useBorrowDemand` paths,
  and the seeded-fork E2E suite running without any indexer process. Final
  streams/demand parity between projection and Ponder was recorded green
  against the post-`gatherLiquidity` ABI before deletion (ticket 11 note).
- `web/tests/lib/discovery/live-cutover.test.ts`: the "parity instrumentation
  only" test became "keeps the deleted indexer stack out of every source
  tree" — the instrumentation module it inspected is deleted, so the
  assertion tightened from an allowlisted exception to a repo-wide negative.
- `web/tests/scripts/security-packaging.test.ts`: the CSP assertion flipped
  from "includes the Ponder origin" to "contains no ponder origin".
- Component tests: dead `vi.mock("@/hooks/useIndexerSync")` boilerplate
  stripped from 8 files; no assertion changed.

## 2026-07-31 — U11 `gatherLiquidity` removal (ticket 10)

Owner: Claude ticket-10 implementation

- `test/OVRFLOLending.t.sol`: removed the "COVERAGE: GATHER FUNCTIONS" block
  (8 tests) and `test/fizz/handlers/OVRFLOLendingHandler.sol` removed
  `oVRFLOLending_gatherLiquidity` — the function under test was removed from
  `OVRFLOLending`. The behaviors those tests guarded remain covered at their
  owners: `_validateLiquidity`/`createBorrowerLoanPool` tests (market/APR
  match, inactive exclusion, self-match) and `lib/router.ts` unit tests
  (bounded, sorted selection with coverage).
- `web/tests-live/parity-freeze.test.ts`: rewrote the route test from
  "selected IDs agree with legacy `gatherLiquidity`" to "route is bounded by
  `MAX_ROUTE_IDS`, strictly increasing, hydrated at the frozen block, and
  covers the target." The legacy comparison target no longer exists;
  agreement was recorded green on 2026-07-31 against the pre-removal ABI as
  ticket 09 resolution evidence.
- `web/tests/lib/discovery/live-cutover.test.ts`: dropped the assertion that
  parity instrumentation still contains a `"gatherLiquidity"` reference — the
  gather branch is gone; the Ponder-branch assertions remain until ticket 11.

## 2026-07-31 — U9 live cutover (ticket 09)

Owner: Claude ticket-09 completion

- `web/tests/e2e/claim-all.feature`: rewrote "a contract revert fails the
  queue mid-flight" as "an externally claimed stream is skipped, never
  submitted." The shared executor re-derives claimables at confirm
  (freeze-what-you-show-recompute-what-you-submit), so the externally claimed
  stream is dropped before signing and the mid-flight revert premise is
  unreachable by design. The scenario now asserts the skip outcome.
- `web/tests/e2e/claim-all.feature`: both scenarios gained explicit
  `LOAD POSITIONS` / `REVIEW CLAIMS` steps for the R53 deferred-personal-scan
  gate and the preflight review stage — new required interactions, not
  relaxed assertions.

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
