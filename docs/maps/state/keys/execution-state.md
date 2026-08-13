# Execution state

Executor phase, write-flow, and transaction-lifecycle latches. All `pure-client`
— every key here is the browser's *record* of an execution, not the execution
itself. The chain is what happened; these keys are what the UI believes and how
it behaves next.

The rule this file exists to hold: **an execution latch may narrow what the UI
does, never widen it.** Every key below can refuse, pause, or re-ask. None of
them authorises a broadcast — the executor re-checks identity and the plan
re-simulates immediately before the wallet is reached.

Cross-position Claim-All is retired. `useTxQueue` remains for per-position claim
continuation ("claim remaining" when the pair cap splits a position) and for
the explicit transaction lifecycle (pending / confirmed / failed / **replaced**).

Entry format and rules: `README.md`.

---

### `executor.status`

The phase of the current action execution.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTransactionExecutor.ts` — set from the runtime's phase callback and from the terminal result
- **readers:**
  - `web/hooks/useWriteFlow.ts` — exposes the derived `isSigning` / `isConfirming` / `isRefreshing` / `needsReview` / `hasFailed` flags
  - `web/components/kit/ActionButton.tsx` — landing U4: per-action pending label (`UI-REVIEW-TX-STATE`)
  - `web/hooks/useApprovalWriteFlows.ts` — the shared `busy` flag every approve-then-write form gates its buttons on
- **notes:** `idle` · the execution phases · the terminal result statuses, in one
  value. The terminal statuses are distinguishable on purpose:
  `reverted`, `rejected`, `simulation_failed`, `transport_failed`,
  `authorization_failed`, `identity_changed`, `invalid`, `needs_review`,
  `refresh_failed`, `success`. Collapsing any of them into a generic "failed"
  destroys the caller's ability to tell *the chain refused* from *we could not
  ask*. `refresh_failed` means the transaction **did** land; approval-progress
  never shows `CONFIRMED`, because a form's completed state derives solely from
  its action transaction (`UI-REVIEW-APPROVE`).

### `executor.result`

The full result object behind `executor.status`.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTransactionExecutor.ts` — set on completion, on retried refresh, and by `report`
- **readers:**
  - `web/hooks/useTransactionExecutor.ts` — derives `hash`, `receipt`, and the surfaced `error`
  - `web/hooks/useWriteFlow.ts` — forwards hash, receipt, and error to the forms
  - `web/hooks/useStaleRecovery.ts` — classifies the surfaced error to decide whether this was a liquidity race
- **notes:** An `invalid` result carries `errors`, not `error`; the surfaced
  `Error` is synthesised from it so a failed pre-submit rebuild cannot dead-end
  silently. That synthesised value is memoised because the stale-recovery effect
  depends on its identity — an unmemoised `new Error` would re-fire the effect
  on every render. USD never appears on the receipt object the UI prints.

### `executor.registry`

Module-scoped map of in-flight and refresh-failed executions, keyed by execution identity.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTransactionExecutor.ts` — inserts on start, deletes on terminal success, retains on `refresh_failed`, and trims retained entries past the cap
- **readers:**
  - `web/hooks/useTransactionExecutor.ts` — deduplicates a repeat `confirm` onto the existing promise, and serves the retained failure to `retryRefresh`
- **notes:** **Not React state** — a module-level `Map` shared by every mounted
  executor, so it survives remounts and outlives the component that created an
  entry. That is what stops a double click, or a remount mid-flight, from
  broadcasting the same action twice. StrictMode double-invocation must leave
  latches single-armed. Retained refresh failures are capped and evicted
  oldest-first. A `ponytail:` ceiling comment names the cap and the upgrade
  (per-account maps if a long session blows it).

### `writeflow.is-preparing`

Whether an action's plan is being built or re-simulated before the wallet is reached.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useWriteFlow.ts` — set around plan preparation, cleared on settle or abort
- **readers:**
  - `web/hooks/useWriteFlow.ts` — folded into `isInFlight`
  - `web/hooks/useApprovalWriteFlows.ts` — part of the shared `busy` flag
- **notes:** Preparation is abortable and generation-counted, so a superseded
  preparation cannot resolve over a newer one. Unmounting aborts it. Reviewed
  actions are rebuilt and identity-checked before every prompt (KTD5).

### `tx.replaced`

A same-nonce replacement (speed-up / cancel) for an in-flight transaction: new hash, same intent.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — records replaced as a first-class lifecycle state
  - `web/hooks/useTransactionExecutor.ts` — reconciles a receipt it did not submit (second tab)
- **readers:**
  - `web/hooks/useWriteFlow.ts` — resolves the flow to the replacement's outcome; never spins on the old hash
  - `web/components/kit/ActionButton.tsx` — landing U4: pending copy follows the live hash
- **notes:** Uniswap `state/transactions` shape: pending, confirmed, failed, and
  **replaced** are first-class. A sped-up transaction resolves. The module
  tolerates receipts it did not submit so a second tab's transactions
  reconcile, never corrupt. Identity remains the account captured at start.

### `queue.rows`

The sequential write run: one row per queued transaction, with its status and any replacement.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — `start`, `resume`, and per-row status updates
- **readers:**
  - `web/hooks/useTxQueue.ts` — derives `done`, `outcome`, `needsReview`, `failed`
  - `web/lib/actions/claim.ts` — landing U6: "claim remaining" continuation when the pair cap splits a position
- **notes:** Not Claim-All. Row statuses are `pending` · `preparing` ·
  `confirmed` · `skipped` · `needs-review` · `failed` · `replaced` ·
  `refresh-failed`. A row becomes `confirmed` only when the injected executor
  resolves `success` — after its receipt and its critical refresh. Every unsent
  row is rebuilt immediately before the executor may prompt the wallet. A
  `confirmed` row is never rewritten.

### `persist.receipts`

A recoverable tx-hash receipt kept until chain reads reflect the created entity.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/receipts.ts` — landing U12: factory-namespaced `ovrflo:receipt:{factory}:{hash}`
  - `web/components/supply/SupplyFlow.tsx` — landing U12: persist on pending / confirmed supply
  - `web/components/borrow/BorrowFlow.tsx` — landing U12: persist on pending / confirmed borrow
- **readers:**
  - `web/lib/receipts.ts` — landing U12: `reconcileReceipt`; `guardConfirmedBalances`
  - `web/hooks/useStaleBalanceGuard.ts` — landing U12: stale RPC must not resurrect pre-tx balances
- **notes:** Executor CONFIRMED waits `RECEIPT_CONFIRMATIONS = 2`. The
  suppression guard re-fetches `getTransactionReceipt`; a null receipt means
  the block reorged out — regress to PENDING rather than pinning CONFIRMED.
  Matching live balances against the pre-tx snapshot suppresses those numbers
  and keeps last-known post-tx. Drop the local receipt once the entity is
  present in reads.

### `queue.running`

Whether the sequential write run is advancing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — set by `start` / `resume`, cleared on every non-advancing outcome
- **readers:**
  - `web/hooks/useTxQueue.ts` — exposed as `running` and `inFlight`
  - `web/components/kit/ActionButton.tsx` — landing U4: blocks a second start while a row is in flight
- **notes:** Closing a review mid-run is blocked while a row is in flight
  because unmounting would discard `queue.rows`; confirmed transactions are
  already on chain but the run's own history is not recoverable.
