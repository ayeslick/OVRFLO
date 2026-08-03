# Region brief — Action modal / overlay

**Slug:** `ACTION` · **Control ID prefix:** `UI-ACTION-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/MarketDetail.tsx` (dialog shell) ·
`web/components/ActionModal.tsx` (`ACTION_META`, `FormBody` router) ·
`web/components/action-flow/` (`ActionFlowShell`, `SupplyFlow`, `BorrowFlow`, `ConvertFlow`,
`ClaimFlow`, `RepayFlow`, `PositionFlow`) · `web/components/RateLadder.tsx` ·
`web/components/ClaimAllModal.tsx`

**Purpose of the region.** Everything that costs a signature happens here. The overlay is
where an intention formed elsewhere becomes an exact, reviewable transaction: what asset,
how much, at what rate, with what on-chain consequence — visible before signing
(`PRODUCT.md` principle 1).

**Two overlays, one contract.** The market action overlay (`MarketDetail` hosting one
`FormBody`) and the claim-all overlay (`ClaimAllModal`) are separate components, but both
are modal dialogs with a scrim, a focus trap, and an Escape path, and neither signs
anything the user has not seen.

**Twelve action types** route through one shell: `supply`, `withdraw`, `claim_share`,
`deposit`, `claim_matured`, `wrap`, `unwrap`, `borrow`, `claim_stream`, `adjust_rate`,
`repay`, `close`. Accent is gold for the lend/claim side, cyan for the borrow side, neutral
for wrap/unwrap — a side marker, never a severity marker.

**Boundary.** The controls that *open* this region live in `settlement.md` and
`positions.md`. This brief owns what happens once it is open.

---

## `UI-ACTION-OVERLAY`

- **ID.** `UI-ACTION-OVERLAY`
- **Purpose.** Contain one action at a time, block the surface behind it, and guarantee the
  user can always leave.
- **Visible when.** `activeMode` is set (a settlement or position control fired), or the
  claim-all overlay is open.
- **States.**
  - `open` — `role="dialog"`, `aria-modal="true"`, labelled by the action's title from
    `ACTION_META`; focus moves to the amount input where the form has one, otherwise to the
    first focusable element (the close button). Switching action type inside an open panel
    re-runs initial focus.
  - `close-blocked` — claim-all only: while a queued transaction is in flight, the close
    button is disabled, Escape is disarmed, and a scrim click does nothing.
  - `closed` — unmounted. Closing clears `activeMode` only; the expanded market row stays
    expanded underneath.
- **Action.** Close via the `✕` button, Escape, or a scrim click. Closing submits nothing
  and cancels nothing already broadcast — a transaction already signed continues on chain
  regardless of this panel.
- **Copy rules.** The heading is the action title from `ACTION_META` and must name the
  action in product terms (`SUPPLY LIQUIDITY`, `BORROW AGAINST STREAM`, `CLAIM MATURED PT`).
  The close control is labelled `Close`. Never imply that closing the overlay reverses,
  cancels, or refunds a submitted transaction.
- **Data authority.** `pure-client` — which overlay is open, and which action it hosts.
  Nothing about the panel itself is chain state.

## `UI-ACTION-NETWORK-GATE`

- **ID.** `UI-ACTION-NETWORK-GATE`
- **Purpose.** Stop every write path when the wallet is on the wrong chain, and offer the
  switch.
- **Visible when.** `useChainGuard().wrongChain` is true — checked in `FormBody`, before any
  form renders. On a wrong chain the gate **replaces** the entire form body, so every one of
  the twelve actions is covered at a single seam.
- **States.** `wrong-chain` (notice plus switch button), `switching` (button disabled,
  reads `SWITCHING…`), `switch-rejected` (adds
  `SWITCH REJECTED — CHANGE NETWORK IN YOUR WALLET`).
- **Action.** Requests a wallet chain switch. It submits no protocol transaction.
- **Copy rules.** State both chain ids: connected and expected. Never let a wrong-chain
  session reach a primary action control — a header-only network indicator is explicitly
  insufficient here, because it informs without preventing.
- **Data authority.** `on-chain` — the connected chain id comes from the wallet connection
  and this is a gate, so it is never taken from cached or client state.

## `UI-ACTION-WALLET-CHANGED`

- **ID.** `UI-ACTION-WALLET-CHANGED`
- **Purpose.** Stop a form whose inputs were entered for a different account from being
  submitted by the new one.
- **Visible when.** The connected address changed while a flow was open
  (`useWalletChangeReset`). It replaces the form body.
- **States.** One: `wallet-changed`, with a `CONTINUE` acknowledgement.
- **Action.** `CONTINUE` resets that flow's client state (amount, selected tick, selected
  stream, local approval bookkeeping, stale-recovery flag) and re-renders the form for the
  new account. No transaction.
- **Copy rules.** `WALLET CHANGED — RE-ENTER`. Do not silently re-scope a half-entered form
  to a new account, and do not preserve the previous account's amounts as a convenience.
- **Data authority.** `on-chain` — the connected account.

## `UI-ACTION-AMOUNT`

- **ID.** `UI-ACTION-AMOUNT`
- **Purpose.** Take the amount the user intends to move, in the units of the token actually
  being spent.
- **Visible when.** Rendered by supply, borrow, repay, and all four convert modes. Not
  rendered by the simple actions (withdraw, claim share, claim stream, close), which take no
  amount.
- **States.**
  - `empty` — placeholder `0.00`.
  - `valid` — parses at 18 decimals.
  - `invalid` — `aria-invalid`, `input-error` styling, and a `role="alert"` message. Live
    validations in the incumbent: `INSUFFICIENT BALANCE` (supply, repay, convert), deposit
    cap errors (convert), and slippage bounds on the separate slippage field.
  - `bounded` — where a balance is shown, `MAX` fills the field; repay's `MAX` is bounded by
    the outstanding obligation rather than the wallet balance, and is disabled when the
    obligation is zero.
  - `no-balance-shown` — borrow renders no balance line and no `MAX`, deliberately: a borrow
    is bounded by posted ladder depth, not by anything in the wallet, and showing a wallet
    balance there would describe the wrong constraint.
- **Action.** Client-side only. It changes what a later confirm would submit; it submits
  nothing itself.
- **Copy rules.** The label names the token being spent — `AMOUNT (<symbol>)` — and for
  deposit that symbol is the literal `PT`, which has no entry in the market symbol map. The
  balance line and the error must both be programmatically associated with the field
  (`aria-describedby`), because a validation state carried only by a CSS class is invisible
  to assistive technology. Never label the field with the token the user *receives*.
- **Data authority.** `pure-client` for the entered string. `on-chain` for the balance shown
  beside it and for every bound that gates submission (wallet balance, outstanding
  obligation, deposit cap, wrap reserve, ladder depth).

## `UI-ACTION-RATE-LADDER`

- **ID.** `UI-ACTION-RATE-LADDER`
- **Purpose.** Choose one discrete tick. APR is discrete on chain — a multiple of the
  market's step within `[aprMinBps, aprMaxBps]` — so the control is an order-book-style
  ladder of ticks, never a slider or a curve.
- **Visible when.** Rendered by `SupplyFlow` (`SUPPLY RATE`), `BorrowFlow` (`BORROW RATE`),
  and `AdjustRateFlow` (`NEW RATE`). It is **not** rendered by the markets table; the
  table's aggregate rate display is `UI-MARKETS-TABLE-RATES`.
- **States.**
  - `empty` — no rows; renders the flow's `emptyText` (`LOADING RATES` on the supply and
    adjust sides, `NO LIQUIDITY POSTED AT ANY RATE` on the borrow side) as a dim label, not
    as an error colour: an empty or still-loading ladder is a placeholder, and status
    colours are reserved for errors.
  - `ready` — one row per tick. Borrow rows show `UPFRONT <pct>` and `DEPTH <amount>`, with a
    `BEST` marker on the best tick. Supply rows show `RETURN <pct>`, `WAITING <amount>`, and
    a demand cell.
  - `selected` — `aria-checked` on the chosen row.
  - It is a `radiogroup`: one tab stop, arrows/Home/End move and select within it. Selection
    and focus move together.
- **Action.** Client-side selection of the tick that the confirm control will submit. No
  transaction.
- **Copy rules.** Both lenses are always available for a rate: APR is the lender lens,
  upfront percentage the borrower lens, and they are one deterministic per-market
  conversion. Borrow-side depth **excludes the user's own supply**, with the footnote
  `YOUR OWN SUPPLY IS EXCLUDED — YOU CANNOT BORROW AGAINST IT`; supply-side `WAITING`
  deliberately includes it. Never present ladder depth as a guaranteed fill — the contract
  clamps a borrow to available liquidity, so a partial fill can confirm.
- **Data authority.** `on-chain` for tick amounts and for the lending params that define the
  tick set — every value that reaches the submitted arguments is hydrated directly.
  `pure-client` for the selection. Demand cells are `projection` (see
  `UI-ACTION-DEMAND-ANNOTATION`) and are annotation only; they never change what is
  submitted and never gate.

## `UI-ACTION-DEMAND-ANNOTATION`

- **ID.** `UI-ACTION-DEMAND-ANNOTATION`
- **Purpose.** Show trailing borrower demand per tick so a lender can price competitively,
  and so an empty borrow ladder does not read as a dead market.
- **Visible when.** Rendered by `SupplyFlow` (per row plus a footer annotation) and by
  `BorrowFlow` when the ladder has no liquid ticks.
- **States.** Four, and none may share a representation:
  - `loading` — `DEMAND —` per row, `DEMAND: LOADING` in the annotation.
  - `unavailable` — `DEMAND: NO DATA` per row, and
    `DEMAND DATA UNAVAILABLE — INDEXER UNREACHABLE` as a warning.
  - `empty` — `NO LOANS IN 30 DAYS`.
  - `ready` — `DEMAND <level> · <count> · <amount>`.
  - "No data" and "genuinely zero borrows" must never look alike.
- **Action.** None — annotation only.
- **Copy rules.** Always state the window and the exclusion:
  `DEMAND: TRAILING 30 DAYS, YOUR OWN BORROWS EXCLUDED`. Demand is **historical**; there is
  no forward book. Never present it as a forecast, an expected fill, or a utilisation
  guarantee.
- **Data authority.** `projection` — aggregated from discovered borrow events. It is a
  candidate signal, never an authority, and it must never feed a gate. Promoting any of it
  to `on-chain`, or letting it reach an `if (…) allow`, is a trust-domain change requiring
  a summary ADR and Owner escalation (`../SCHEMAS.md` §2).

## `UI-ACTION-STREAM-SELECT`

- **ID.** `UI-ACTION-STREAM-SELECT`
- **Purpose.** Choose which held stream to pledge, when the borrow flow was opened from the
  market row rather than from a specific stream card.
- **Visible when.** `BorrowFlow` opened with no `streamId`. When the flow was opened from a
  stream card the selection is fixed and rendered as a static `STREAM <id>` label instead.
- **States.** `unselected` (`SELECT STREAM`), `selected`, `empty` (no series-matched streams,
  so the list has only the placeholder), and `recipient-mismatch` — the selected stream's
  on-chain recipient is not the connected wallet, which renders
  `CONNECTED WALLET IS NOT RECIPIENT` and blocks submission.
- **Action.** Client-side selection. Changing it resets the action transaction and clears
  stale-recovery state — a terminal error is terminal for the *stream*, not for the form.
- **Copy rules.** Options show the stream id and its remaining value in the market's
  ovrfloToken. Never list a stream that is not series-matched to this market.
- **Data authority.** `projection` for the discovered stream list — it narrows what to offer.
  `on-chain` for the recipient check that gates submission (`Sablier.getRecipient`) and for
  the stream's own values.

## `UI-ACTION-SLIPPAGE`

- **ID.** `UI-ACTION-SLIPPAGE`
- **Purpose.** Bound how much worse than the quote the borrower will accept, as the
  `minAcceptable` argument.
- **Visible when.** `BorrowFlow` only.
- **States.** `valid` (0.1–5%), `invalid` (`input-error` plus
  `SLIPPAGE MUST BE 0.1–5%`, and submission is blocked because `minAcceptable` cannot be
  computed).
- **Action.** Client-side; it sets the on-chain floor applied to the quoted net.
- **Copy rules.** State the accepted range in the error. Never describe slippage as a fee or
  as an amount the user pays — it is a floor below which the transaction reverts.
- **Data authority.** `pure-client` for the entered tolerance; the floor it produces is
  applied to an `on-chain` quote and is submitted as a contract argument.

## `UI-ACTION-QUOTE-SUMMARY`

- **ID.** `UI-ACTION-QUOTE-SUMMARY`
- **Purpose.** State the exact consequence of the pending action before signing, in the
  assets it will actually move.
- **Visible when.** Every flow renders a `summary-row` with `aria-live="polite"`; the
  contents differ per action.
- **States.**
  - `idle` — `—` (nothing entered yet).
  - `loading` — `LOADING` while a preview or quote read is in flight.
  - `ready` — borrow: `NET / OBLIGATION / RESIDUAL`. Deposit: `TO WALLET / STREAM / FEE`.
    Supply: `SUPPLY <amount> @ <apr>`. Repay: `REPAY <amount> / REMAINING <amount>`.
    Adjust: `MOVE <amount> TO <apr>`. Simple actions: the action and its target id.
  - `receipt` — after confirmation, borrow and adjust render a receipt summary decoded from
    the transaction logs, flagging a partial fill, a quote/received divergence, or a
    wallet top-up as a warning.
- **Action.** None — it is the review surface, not a control.
- **Copy rules.** Name the asset for every figure: obligation and residual are in
  ovrfloToken, net and fee in the underlying, deposit output in ovrfloToken. Never round
  away a difference between quoted and received — the receipt exists to surface it. Never
  describe the obligation as a debt at risk of liquidation; it is the amount the stream
  repays on schedule.
- **Data authority.** `on-chain` — previews and quotes are contract reads
  (`OVRFLO.previewDeposit`, `OVRFLOLending.quote`), and receipts are decoded from the
  confirmed transaction's own logs.

## `UI-ACTION-APPROVE`

- **ID.** `UI-ACTION-APPROVE`
- **Purpose.** Grant the exact allowance (or stream approval) the pending action needs, as a
  separate, visible step.
- **Visible when.** The flow needs an approval that is not already covered. It **replaces**
  the confirm control until satisfied, so the two are never simultaneously live. Variants:
  `APPROVE` (supply, adjust), `APPROVE PT` / `APPROVE <underlying>` (convert),
  `APPROVE REPAY` (repay), `APPROVE STREAM` (borrow, an ERC-721 stream approval to the
  lending market).
- **States.** `armed`, `signing`, `confirming` (with a truncated hash), `refreshing`,
  `refresh-failed` (with `RETRY REFRESH`), `reverted`, `error`, and
  `zero-first-clearing` — `THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE`
  for tokens that demand a zero allowance before a new one.
  A failed approval clears the flow's local "approved" bookkeeping so the step re-arms
  honestly.
- **Action.** ERC-20 `approve` to the vault or the lending market, or Sablier `approve` of
  the stream to the lending market. It moves no value. Approval amounts are exact, except
  the deposit fee, which carries a small buffer because it requotes between blocks.
- **Copy rules.** The approval step **never** renders `CONFIRMED` — a form's completed state
  derives solely from the action transaction. Never present an approval as the action.
  Never request an unbounded allowance without saying so.
- **Data authority.** `on-chain` — current allowance, stream approval, and operator status
  are read from the token, Sablier, and lending contracts. Local approved-amount state is
  `pure-client` optimism that only ever hides the button; the on-chain allowance is what
  the transaction depends on.

## `UI-ACTION-CONFIRM`

- **ID.** `UI-ACTION-CONFIRM`
- **Purpose.** Submit the action the summary describes.
- **Visible when.** Rendered once approvals are covered (or where none are needed). One per
  flow; labelled for the action: `SUPPLY @ <apr>`, `BORROW`, `DEPOSIT`/`WRAP`/`UNWRAP`/
  `CLAIM`, `REPAY <amount>`, `ADJUST RATE`, `WITHDRAW`, `CLAIM SHARE`, `CLAIM STREAM`,
  `CLOSE LOAN`.
- **States.**
  - `disabled` — inputs incomplete, validation failed, market matured, a required read
    unresolved, no route selected, or a terminal error is in force.
  - `armed` — every precondition met.
  - `busy` — an approval or the action is in flight.
  - `re-confirm` — a recoverable race was detected; the label changes to
    `RE-CONFIRM BORROW` / `RE-CONFIRM ADJUST RATE` and one explicit re-confirmation is
    required against the refreshed numbers.
  - `confirmed` — stays disabled after confirmation, so the same arguments cannot be
    submitted twice by a second click.
  - Matured markets are refused with their own notice (`MARKET MATURED — BORROWING CLOSED`,
    `— SUPPLY CLOSED`, `— RATES CLOSED`, `CLAIM ENABLES AFTER MATURITY`) rather than a
    silent disable.
- **Action.** The on-chain write. `supplyLiquidity`, `createBorrowerLoanPool`,
  `deposit`, `claim`, `wrap`, `unwrap`, `repayLoan`, `closeLoan`, `withdrawLiquidity`,
  `claimLoanPoolShare`, Sablier `withdrawMax`, or the adjust `multicall`
  (`withdrawLiquidity` + `supplyLiquidity`). Adjust re-reads the position's idle amount
  immediately before submitting and routes any change through re-confirmation rather than
  submitting a stale value.
- **Copy rules.** The label names the action and, where a number is decided, the number
  (`REPAY <amount>`, `SUPPLY @ <apr>`). Never promise an outcome the contract can clamp: a
  borrow may fill partially. Never present the confirm as reversible. Never soften a
  reverted transaction — `TRANSACTION REVERTED ON-CHAIN` is a distinct state from a signing
  rejection and from a read failure.
- **Data authority.** `on-chain` for every argument and every gate. A projection value may
  narrow the candidate route but never authorises the submission — route ids are hydrated
  and re-selected from direct reads before they enter the call.

## `UI-ACTION-STEPS`

- **ID.** `UI-ACTION-STEPS`
- **Purpose.** Tell the user how many signatures this action takes and which one they are
  on.
- **Visible when.** Every flow. `["APPROVE", "SIGN", "CONFIRMED"]` where an approval is
  needed, `["SIGN", "CONFIRMED"]` where it is not, and borrow uses
  `["APPROVE STREAM", "SIGN", "CONFIRMED"]`.
- **States.** Per step: `step-done`, `step-active`, `step-pending`, `step-error`. The list is
  `aria-live="polite"`.
- **Action.** None — indicator only. It is not clickable and is not navigation.
- **Copy rules.** The step count must match the signatures actually required, including the
  zero-first double approval when it applies. `CONFIRMED` is reached only by the action
  transaction, never by an approval.
- **Data authority.** `on-chain` — derived from the write flows' transaction states.

## `UI-ACTION-TX-STATE`

- **ID.** `UI-ACTION-TX-STATE`
- **Purpose.** Report exactly where a submitted transaction is, and distinguish the ways it
  can fail.
- **Visible when.** Every flow renders it beneath the confirm control.
- **States.** All distinct, none interchangeable:
  - `signing` — awaiting the wallet.
  - `confirming` — broadcast, with a truncated hash.
  - `refreshing` — `CONFIRMED — REFRESHING`.
  - `refresh-failed` — `TRANSACTION CONFIRMED — REFRESH FAILED <hash>` plus
    `RETRY REFRESH`. The transaction succeeded; only the UI's re-read failed, and the copy
    must keep those apart.
  - `confirmed` — `CONFIRMED`.
  - `needs-review` — `ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN`, with the updated
    call and arguments shown.
  - `reverted` — `TRANSACTION REVERTED ON-CHAIN`.
  - `error` — a user-facing error string.
  - Borrow adds recoverable-race copy:
    `LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM`; adjust adds
    `IDLE AMOUNT CHANGED SINCE THE FORM OPENED — REVIEW THE NEW NUMBER AND RE-CONFIRM`.
- **Action.** `RETRY REFRESH` re-reads; it submits nothing.
- **Copy rules.** A confirmed transaction whose refresh failed must never be reported as a
  failure, and a revert must never be reported as a generic error. A rejected signature is
  not a revert. Never claim success before the receipt.
- **Data authority.** `on-chain` — transaction status and receipt.

## `UI-ACTION-CLAIM-ALL-PREFLIGHT`

- **ID.** `UI-ACTION-CLAIM-ALL-PREFLIGHT`
- **Purpose.** Prove the batch is being built from a complete, corroborated candidate set
  before offering to review it — and refuse the batch when it is not.
- **Visible when.** The claim-all overlay is open and the user has not yet entered review.
- **States.** Per source (`markets`, `streams`, `hydration`, `verifier`): status plus either
  a `RETRY <source>` control (retryable failures) or an explanatory message. Overall, the
  batch is blocked with named copy for `verifier-unavailable`, `provider-disagreement`,
  `hydration-incomplete`, `snapshot-mismatch`, `discovery-incomplete`, and for a displayed
  plan that no longer matches the corroborated preflight.
- **Action.** `RETRY <source>` re-runs one preflight source. `CANCEL PREFLIGHT` closes.
  Neither signs.
- **Copy rules.** A blocked batch must always name the route that still works:
  `INDIVIDUAL VERIFIED CLAIMS AND KNOWN-ID RECOVERY REMAIN AVAILABLE`. Never present a
  blocked batch as "nothing to claim". Never let an unavailable verifier degrade into a
  permissive default.
- **Data authority.** `projection` for the discovered candidate set and its corroboration —
  and this control is the enforcement point of the rule that a projection may narrow what to
  ask about but may never decide what is allowed: an uncorroborated projection **disables**
  the batch rather than authorising it (`../SCHEMAS.md` §2). `on-chain` for the hydrated
  claimable values.

## `UI-ACTION-CLAIM-ALL-QUEUE`

- **ID.** `UI-ACTION-CLAIM-ALL-QUEUE`
- **Purpose.** Show every transaction the batch will submit, and then each one's outcome, so
  a multi-signature batch is reviewable before and legible during.
- **Visible when.** After `REVIEW CLAIMS`, and throughout execution.
- **States.** Per row: `QUEUED` before start, then `PENDING`, `PREPARING`, `CONFIRMED`,
  `SKIPPED`, `NEEDS REVIEW`, `PAUSED`, `REFRESH FAILED`, `FAILED`. Batch-level:
  `paused` (`QUEUE PAUSED — RE-EVALUATING COMPLETENESS, ACCOUNT, AND CHAIN`),
  `failed` (`TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES`),
  `needs-review` (`CLAIMS CHANGED — REVIEW THE UPDATED GROUP BEFORE CONTINUING`),
  `nothing-left` (`NOTHING LEFT TO CLAIM — THESE WERE CLAIMED ELSEWHERE WHILE THIS WAS OPEN`),
  `review-changed` (`CLAIMS CHANGED WHILE REVIEWING — CHECK THE UPDATED QUEUE`),
  `done` (`ALL CLAIMS CONFIRMED` or `ALL AVAILABLE CLAIMS CONFIRMED — SOME ROWS SKIPPED`),
  and `empty` (`NOTHING CLAIMABLE`).
- **Action.** None per row — the queue is a report. Execution is driven by
  `UI-ACTION-CLAIM-ALL-CONFIRM`.
- **Copy rules.** A skipped row must be reported, not hidden: a completed batch with skips
  says so. Never report a batch as complete when rows were skipped. Never describe the batch
  as atomic — it is a sequential queue of independent transactions.
- **Data authority.** `on-chain` for each row's execution state and for the pre-submit
  rebuild that decides whether a row still applies. `projection` for the candidate set that
  produced the rows.

## `UI-ACTION-CLAIM-ALL-CONFIRM`

- **ID.** `UI-ACTION-CLAIM-ALL-CONFIRM`
- **Purpose.** The single point at which the batch starts signing, and the controls that
  carry it through interruptions.
- **Visible when.** One control at a time, by batch state: `REVIEW CLAIMS` (preflight
  passed), `CONFIRM QUEUE` (reviewing), `REVIEW CHANGES` (claims changed mid-run),
  `RESUME` (failed or paused), `DONE` (complete).
- **States.** Each is disabled unless the preflight still corroborates the live plan; `RESUME`
  is additionally disabled while a transaction is in flight.
- **Action.** `CONFIRM QUEUE` re-plans from the live props at submit time — not from the
  frozen review snapshot — and either starts the queue, or reports that nothing is left, or
  surfaces a changed plan for another look. `RESUME` and `REVIEW CHANGES` always re-plan.
  Each queued row is rebuilt against a captured block immediately before simulation, so a
  change landing between rows becomes a skip or a review rather than a bad submission.
  Focus is parked deliberately: on the heading when the confirm unmounts, on `DONE` at
  completion, on the close button on failure.
- **Copy rules.** `CONFIRM QUEUE` must never be reachable for a plan the user has not seen.
  Never label the batch as one transaction. Never re-enable confirmation on a stale plan.
- **Data authority.** `on-chain` for the pre-submit rebuild and every submitted argument.
  `projection` for candidates, and it is blocking rather than permissive.

## `UI-ACTION-ERROR-BOUNDARY`

- **ID.** `UI-ACTION-ERROR-BOUNDARY`
- **Purpose.** Contain a crash in an action form without trapping the user inside a dialog.
- **Visible when.** A form body throws. It wraps the **body only** — the modal header and
  close button stay outside, so the user can always leave.
- **States.** `caught` — `SOMETHING WENT WRONG — <message>` with `TRY AGAIN`, under
  `role="alert"`.
- **Action.** `TRY AGAIN` clears the error and bumps the parent's remount key, so the form
  is genuinely re-created rather than re-rendering the same failing subtree into an
  immediate re-throw. No transaction.
- **Copy rules.** State that something failed and offer the retry. Never claim the
  transaction did or did not go through — the boundary does not know. Never render a crash
  as an empty form.
- **Data authority.** `pure-client` — this is a render fault, not chain state.

---

## Region copy rules

1. **Nothing signs that the user has not seen.** The quote summary, the step indicator, and
   the claim-all review exist so that the exact assets, amounts, timing, fees, and on-chain
   consequence are visible before signing (`PRODUCT.md` principle 1).
2. **Approval is not the action.** Approval states never render `CONFIRMED`.
3. **Every failure mode keeps its own words.** Signing rejection, revert, read failure,
   refresh-after-confirm failure, stale-route race, and unavailable projection are six
   different events with six different consequences.
4. **No liquidation, health factor, margin call, collateral ratio, or liquidation price.**
   Not in a form, not in a summary line, not in a confirmation, not as a risk meter beside
   an obligation. Loans are self-repaying; there is no liquidation mechanism to describe
   (`PRODUCT.md` — *Positioning*, *Capabilities and Constraints*).
5. **Generative comp content is not product behaviour.** A gauge, score, or badge that
   appears in a comp with no product truth behind it does not enter a form, however good it
   looks. Comps win on pixels; briefs win on meaning (`../README.md`).
6. **Projection may not authorise.** In this region the rule is enforced concretely: an
   uncorroborated candidate set disables the batch instead of permitting it. Any change that
   lets a projection value reach an `if (…) allow` is a trust-domain change requiring a
   summary ADR and Owner escalation (`../SCHEMAS.md` §2).
