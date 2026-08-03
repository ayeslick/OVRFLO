# Execution state

Executor phase, write-flow, and Claim All queue latches. All `pure-client` — every
key here is the browser's *record* of an execution, not the execution itself. The
chain is what happened; these keys are what the UI believes and how it behaves next.

The rule this file exists to hold: **an execution latch may narrow what the UI does,
never widen it.** Every key below can refuse, pause, or re-ask. None of them
authorises a broadcast — the executor re-checks identity and the plan re-simulates
immediately before the wallet is reached.

Entry format and rules: `README.md`.

---

### `executor.status`

The phase of the current action execution.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTransactionExecutor.ts` — set from the runtime's phase callback and from the terminal result
- **readers:**
  - `web/hooks/useWriteFlow.ts` — exposes the derived `isSigning` / `isConfirming` / `isRefreshing` / `needsReview` / `hasFailed` flags
  - `web/components/action-flow/ActionFlowShell.tsx` — `TxState` and `ApproveTxState` render one message per phase
  - `web/hooks/useApprovalWriteFlows.ts` — the shared `busy` flag every approve-then-write form gates its buttons on
- **notes:** `idle` · the execution phases · the terminal result statuses, in one
  value. The terminal statuses are distinguishable on purpose:
  `reverted`, `rejected`, `simulation_failed`, `transport_failed`,
  `authorization_failed`, `identity_changed`, `invalid`, `needs_review`,
  `refresh_failed`, `success`. Collapsing any of them into a generic "failed"
  destroys the caller's ability to tell *the chain refused* from *we could not
  ask* — the same failure as a projection collapsing empty into unavailable.
  `refresh_failed` in particular means the transaction **did** land; the
  approval-progress renderer deliberately never shows CONFIRMED, because a
  form's completed state derives solely from its action transaction.

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
  on every render.

### `executor.registry`

Module-scoped map of in-flight and refresh-failed executions, keyed by execution identity.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTransactionExecutor.ts` — inserts on start, deletes on terminal success, retains on `refresh_failed`, and trims retained entries past the cap
- **readers:**
  - `web/hooks/useTransactionExecutor.ts` — deduplicates a repeat `confirm` onto the existing promise, and serves the retained failure to `retryRefresh`
- **notes:** **Not React state** — a module-level `Map` shared by every mounted
  executor, so it survives remounts and outlives the component that created an
  entry. That is the point: it is what stops a double click, or a remount
  mid-flight, from broadcasting the same action twice. It is also the one key in
  this catalog whose lifetime is not bounded by a component, so a change to its
  eviction rules has app-wide blast radius. Retained refresh failures are capped
  and evicted oldest-first so a long session cannot grow it without bound.

### `writeflow.is-preparing`

Whether an action's plan is being built or re-simulated before the wallet is reached.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useWriteFlow.ts` — set around plan preparation, cleared on settle or abort
- **readers:**
  - `web/hooks/useWriteFlow.ts` — folded into `isInFlight`
  - `web/hooks/useApprovalWriteFlows.ts` — part of the shared `busy` flag
- **notes:** Preparation is abortable and generation-counted, so a superseded
  preparation cannot resolve over a newer one. Unmounting aborts it.

### `queue.rows`

The Claim All queue: one row per queued transaction, with its status and any replacement.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — `start`, `resume`, `acceptReview`, and per-row status updates
- **readers:**
  - `web/hooks/useTxQueue.ts` — derives `done`, `outcome`, `needsReview`, `failed`, and the confirmed count
  - `web/components/ClaimAllModal.tsx` — renders the row list once the run has started
- **notes:** Row statuses are `pending` · `preparing` · `confirmed` · `skipped` ·
  `needs-review` · `paused` · `refresh-failed` · `failed`, and they are not
  interchangeable: `skipped` means nothing was left to claim, `paused` means an
  invariant broke, `needs-review` means the plan changed under the user.
  A row becomes `confirmed` **only** when the injected executor resolves
  `success` — after its receipt and its critical refresh. The queue never
  simulates, signs, waits for a receipt, or refreshes on its own, and every
  unsent row is rebuilt immediately before the executor may prompt the wallet.
  A `confirmed` row is never rewritten, so history survives a resume.

### `queue.running`

Whether the queue is advancing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — set by `start` / `resume` / `acceptReview`, cleared on pause and on every non-advancing outcome
- **readers:**
  - `web/hooks/useTxQueue.ts` — exposed as `running` and `inFlight`
  - `web/components/ClaimAllModal.tsx` — blocks close and Escape while a row is in flight
- **notes:** Closing the modal mid-run is blocked because unmounting discards
  `queue.rows`; the confirmed transactions are already on chain but the run's
  own history is not recoverable.

### `queue.paused`

Whether the queue stopped on a broken invariant rather than on a failure.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — `pauseAt`, cleared by `start` / `resume` / `acceptReview`
- **readers:**
  - `web/hooks/useTxQueue.ts` — exposed as `paused`
  - `web/components/ClaimAllModal.tsx` — renders the paused state and the resume affordance
- **notes:** Pausing is a **stop**, not a warning. It happens before the executor
  can reach the wallet, and the invariant is re-checked twice: once before the
  row is rebuilt and again after the async rebuild, immediately before the
  wallet prompt.

### `queue.pause-reason`

Which invariant broke.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — set alongside `queue.paused`
- **readers:**
  - `web/components/ClaimAllModal.tsx` — selects the copy explaining what to fix
- **notes:** `completeness` · `agreement` · `hydration` · `account` · `chain`.
  `completeness` and `agreement` come from the preflight — the batch is refused
  when the corroborated preflight and the displayed claims disagree, rather than
  claiming what is displayed. `account` and `chain` are checked against the
  queue's owning identity, which is captured when the run starts. Merging these
  into one reason would leave the user unable to tell a wallet switch from an
  incomplete read.

### `queue.error`

The last error the queue surfaced.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useTxQueue.ts` — set on rebuild throw, executor throw, refresh failure, and unclassified failure
- **readers:**
  - `web/components/ClaimAllModal.tsx` — renders the failure copy
- **notes:** Cleared at the start of every new run so a stale error cannot
  outlive the row it belonged to.

### `claim-all.review-plan`

The plan the user is reviewing, before the queue owns it.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/ClaimAllModal.tsx` — seeded from `planClaimAll({ pools, streams })`; RESUME recomputes it from the live props
- **readers:**
  - `web/components/ClaimAllModal.tsx` — rendered as the row list until the run starts, then handed to `useTxQueue`
- **notes:** Built from `projection.lender` and `projection.stream` data, so it
  is a **proposal**, not a claim of claimability. The preflight corroborates it
  through a second, independent transport before the batch is allowed to run,
  and each row is rebuilt again at execution time.

### `claim-all.started`

Whether the user has committed the reviewed plan to the queue.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/ClaimAllModal.tsx` — `started`
- **readers:**
  - `web/components/ClaimAllModal.tsx` — switches the row list from `claim-all.review-plan` to `queue.rows`, and keeps the review pane from collapsing mid-run
- **notes:** The switch-over point between the two row sources. Reading rows from
  the wrong side of it shows the user a list that is not the one executing.

### `claim-all.reviewing`

Whether the review pane is open.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/ClaimAllModal.tsx` — `reviewing`; forced closed when the plan stops being reviewable and the run has not started
- **readers:**
  - `web/components/ClaimAllModal.tsx` — renders the review pane
- **notes:** Disclosure only.

### `claim-all.review-changed`

Whether the plan changed while the user was reviewing it.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/ClaimAllModal.tsx` — `reviewChanged`
- **readers:**
  - `web/components/ClaimAllModal.tsx` — warns before the user confirms a plan that is no longer the one shown
- **notes:** The UI half of the same guard the queue enforces with
  `needs-review` rows. The queue's version is the one that stops execution.

### `claim-all.nothing-left`

Whether everything the user reviewed was already claimed elsewhere.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/ClaimAllModal.tsx` — `nothingLeft`
- **readers:**
  - `web/components/ClaimAllModal.tsx` — says so explicitly
- **notes:** Exists so the modal does not queue nothing and report success.
  "Already claimed" and "claimed just now" are different outcomes and must read
  differently.
