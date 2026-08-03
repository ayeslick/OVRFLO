# Projection keys

Browser-side verified-log projection (`web/lib/discovery/`). Every key in this file
is a **candidate set, never an authority** (`../../SCHEMAS.md` §2).

Projection answers exactly one question:

```
Projection:  "which ids might be relevant to me?"   — a candidate set
Chain:       everything else                         — the authority
```

Two rules apply to every entry here, and both are review-blocking:

- **No projected field may reach an `if (…) allow`.** Wrong display data misleads;
  wrong gate data authorises. Fields that decide eligibility are re-read from the
  source — Sablier or the lending contract — not taken from the projection.
- **`empty` and `could not ask` must never share a representation.** They lead to
  opposite user actions: one says "you have nothing here, move on", the other says
  "do not trust this screen". Every projection here resolves to a `ReadOutcome`
  (`web/lib/read-outcome.ts`) whose `status` is `loading` · `ready` · `partial` ·
  `unavailable`, with `freshness` on the two that carry data. A consumer that maps
  anything other than `ready` onto an empty list without also surfacing
  unavailability has reintroduced the defect.

Background: `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`.

Promoting any of these facts to `on-chain`, or letting one feed a gate, is a
trust-domain change: summary ADR required, escalates to the Owner (`../../REVIEW.md`).

Entry format and rules: `README.md`.

---

### `projection.stream`

Candidate Sablier stream IDs held by the connected account, hydrated at the
projection block.

- **trust_domain:** `projection`
- **writers:**
  - `web/hooks/useProjectionSync.ts` — owns the TanStack query under `projectionKeys.scope({ kind: "stream", account })`
  - `web/hooks/useLendingProjection.ts` — `useHeldStreamProjection` binds the scope to `discoverHeldStreams`
  - `web/lib/discovery/live-projection.ts` — produces the outcome: OVRFLO-origin streams intersected with recipient Transfer logs, then hydrated from Sablier
- **readers:**
  - `web/hooks/useHeldStreams.ts` — unwraps the outcome and derives `unavailable`
  - `web/components/PositionSummary.tsx` — the held-stream side of the portfolio rollup and the Claim All plan
  - `web/components/PositionList.tsx` — per-market stream rows
  - `web/components/MarketRowDetail.tsx` — streams available to act on in the expanded row
  - `web/components/action-flow/BorrowFlow.tsx` — the stream picker's candidate list
  - `web/lib/query-resource-registry.ts` — every loan or stream write reconciles active `kind: "stream"` scopes
- **notes:** **Fail-closed contract.** Discovery names IDs; it never asserts
  ownership. Every surviving ID is hydrated directly from Sablier
  (`getStream`, `withdrawableAmountOf`, `ownerOf`) and any stream whose on-chain
  owner is not the connected address is dropped. Eligibility —
  `sender`, `asset`, `endTime`, `canceled`, `depleted` — is checked by
  `isSeriesMatchedStream` (`web/lib/modal-logic.ts`) against those hydrated
  fields, never against projected metadata.
  `useHeldStreams` returns an empty list for **every** non-`ready` status *and*
  raises `unavailable` alongside it, so a consumer reading only `streams` and
  ignoring `unavailable` will render a confident empty portfolio during a
  transport failure. Callers must read both. `unavailable` also absorbs the
  upstream registry's error and `tooLarge` states, so an incomplete vault
  registry cannot present as "no streams".
  Closing a loan consumes its backing stream, and a loan ID does not encode a
  stream ID — so loan writes reconcile every active stream scope rather than
  guessing the affected one.

### `projection.lender`

Candidate loan-pool and loan IDs for one account on one lending market.

- **trust_domain:** `projection`
- **writers:**
  - `web/hooks/useProjectionSync.ts` — owns the query under `projectionKeys.scope({ lending, kind: "lender", account })`
  - `web/hooks/useLendingProjection.ts` — `useAccountLoanBookProjection` binds the scope to `discoverAccountLoanBook`
  - `web/lib/discovery/lending-projection.ts` — log scan and candidate assembly
  - `web/lib/discovery/live-projection.ts` — hydration into the account loan book
- **readers:**
  - `web/hooks/useLoanBook.ts` — unwraps the outcome into `pools` and `loans`
  - `web/hooks/useBorrowerLoans.ts` — unwraps the same scope into the borrower's `loans` only, with an optional poll interval
  - `web/components/PositionSummary.tsx` — open-loan count, obligation, and satisfied totals; source of the Claim All plan
  - `web/components/PositionList.tsx` — per-market pool and loan rows
  - `web/components/action-flow/RepayFlow.tsx` — the loan being repaid, polled while the form is open
  - `web/lib/query-resource-registry.ts` — loan and liquidity-position writes reconcile the lender, borrower, and demand scopes for that lending market
- **notes:** **Fail-closed contract.** `useLoanBook` returns `[]` for both lists
  on every non-`ready` status and exposes `outcome` alongside them — a consumer
  that reads `pools` / `loans` without checking `outcome.status` shows "no
  positions" for a failed read. `useBorrowerLoans` wraps the same scope with the
  same shape and the same obligation on its callers. `PositionSummary` keeps per-market readiness in
  `positions.aggregates` for this reason: a symbol renders `—` until every
  market reporting under it is ready, so one market's unavailability is never
  absorbed into another market's total.
  One account-scoped projection supplies **both** the lender-pool and
  borrower-loan views so the two share one pinned candidate set and one
  hydration result; splitting them would let the same screen show two
  disagreeing snapshots. Note that the refresh planner also names a
  `kind: "borrower"` selector for which no producer currently registers a scope
  — reconciliation of borrower views happens through this `lender` scope.
  Claimability shown here is a proposal. The batch is corroborated by
  `projection.claim-verifier` and each row is rebuilt at execution time before
  any wallet prompt.

### `projection.market-apr`

Candidate liquidity positions on one market's rate ladder.

- **trust_domain:** `projection`
- **writers:**
  - `web/hooks/useProjectionSync.ts` — owns the query under `projectionKeys.scope({ lending, kind: "market-apr", market })`
  - `web/hooks/useLendingProjection.ts` — `useMarketLiquidityProjection` binds the scope to `discoverMarketLiquidity`
  - `web/lib/discovery/lending-projection.ts` — ladder log scan
  - `web/lib/discovery/live-projection.ts` — hydration into positions
- **readers:**
  - `web/hooks/useLendingLiquidity.ts` — unwraps and sorts the positions
  - `web/components/MarketRowDetail.tsx` — ladder depth in the expanded row
  - `web/components/PositionSummary.tsx` — the user's own standing liquidity
  - `web/components/PositionList.tsx` — per-position rows
  - `web/components/action-flow/SupplyFlow.tsx` — depth at the tick being supplied to
  - `web/components/action-flow/BorrowFlow.tsx` — the candidate positions a borrow route is assembled from
  - `web/components/action-flow/PositionFlow.tsx` — the position being adjusted
  - `web/lib/router.ts` — assembles a borrow route across candidate positions; receives them as an argument rather than calling the hook, and relies on the descending-ID order `useLendingLiquidity` establishes
  - `web/lib/query-resource-registry.ts` — market-depth and liquidity-position writes reconcile this scope
- **notes:** **Fail-closed contract.** `useLendingLiquidity` returns `[]` on
  every non-`ready` status and exposes `outcome` and `error` beside it; an empty
  ladder rendered without checking `outcome.status` claims "no liquidity" when
  the truth may be "could not ask", and a user acting on that mis-prices their
  own order.
  Depth here is a **candidate set for route assembly, not a fill guarantee**.
  The route `web/lib/router.ts` builds is re-simulated and the fill is decided on
  chain; a tick that looked deep may fill short or revert as stale. That race is
  handled by `action.stale-recovery`, not by trusting this key.
  A liquidity-position ID does not encode market or APR, so a position write
  reconciles the already-known active scopes for that lending market rather than
  guessing a historical scope; a whole-market key (null `aprBps`) contains every
  tick and is therefore matched by any tick-scoped selector.

### `projection.demand`

Trailing borrow activity per rate tick on one market.

- **trust_domain:** `projection`
- **writers:**
  - `web/hooks/useProjectionSync.ts` — owns the query under `projectionKeys.scope({ lending, kind: "demand", market })`
  - `web/hooks/useLendingProjection.ts` — `useBorrowDemandProjection` binds the scope to `discoverBorrowDemand`
  - `web/lib/discovery/live-projection.ts` — borrow-event scan
- **readers:**
  - `web/hooks/useBorrowDemand.ts` — aggregates events into per-tick demand and derives the three-valued status
  - `web/components/action-flow/BorrowFlow.tsx` — demand annotation beside the ladder
  - `web/components/action-flow/SupplyFlow.tsx` — demand annotation beside the ladder
  - `web/components/action-flow/ActionFlowShell.tsx` — `demandCellCopy` and `DemandAnnotation` render it
- **notes:** **Fail-closed contract, and the clearest worked example of it.**
  `demandCellCopy` distinguishes three answers that a naive implementation would
  collapse into one: `DEMAND —` for loading, `DEMAND: NO DATA` for unavailable,
  and `NO LOANS IN 30 DAYS` for a genuinely empty tick. "Nobody wants to borrow
  at this rate" and "we could not find out" point a lender in opposite
  directions. `useBorrowDemand` also folds `chain.block-timestamp` into the same
  status, because without a window boundary the aggregation is not merely empty
  — it is unanswerable.
  Purely informational: demand never gates an action and the user's own borrows
  are excluded from it so the annotation cannot be self-inflated.

### `projection.claim-verifier`

Independently corroborated Claim All candidates, read through a second RPC provider.

- **trust_domain:** `projection`
- **writers:**
  - `web/hooks/useClaimAllPreflight.ts` — owns the query under `projectionKeys.scope({ kind: "claim-verifier", account, transportRole })`, running the primary and verifier discoveries in parallel
  - `web/hooks/useProjectionSync.ts` — `getProjectionClient("verifier")` resolves a transport distinct from the historical one
- **readers:**
  - `web/components/PositionSummary.tsx` — passes the evaluation into `ClaimAllModal`
  - `web/components/ClaimAllModal.tsx` — `preflightInvariant` supplies the queue's `completeness` and `agreement` invariants and the batch-disabled copy
  - `web/hooks/useTxQueue.ts` — pauses before any wallet prompt when the invariant is not ready
- **notes:** **The strongest fail-closed rule in the catalog: disagreement
  blocks.** When the two providers return different candidate sets the outcome
  is a `blocked` evaluation with reason `provider-disagreement`, not a merge,
  not the primary's answer, and not a warning the user can click past — the
  batch is refused. If the displayed claims stop matching the corroborated
  preflight, `ClaimAllModal` disables the batch and says so rather than claiming
  what is displayed.
  The verifier transport must be a genuinely different provider; when no second
  provider is configured, `getProjectionClient("verifier")` throws rather than
  silently corroborating a projection against itself. The scope carries
  `transportRole` so the primary and verifier reads occupy separate cache
  entries and cannot collapse into one.
  `staleTime` is `0` and the evaluation is withheld while refetching — a
  corroboration is only meaningful at the moment it is taken, so a cached
  agreement must not authorise a later batch.
