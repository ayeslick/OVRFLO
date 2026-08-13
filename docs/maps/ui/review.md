# Region brief — Split review + receipts

**Slug:** `REVIEW` · **Control ID prefix:** `UI-REVIEW-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/action-flow/ActionFlowShell.tsx` until U8–U11
compose kit `SettlementTrace` and `Receipt`.

**Purpose of the region.** Everything that costs a signature: the split review
composition, the SETTLEMENT step trace, PERMISSION and ACTION receipts, and the
checkpoint grammar `READY → WALLET_SIGNATURE → PENDING → CONFIRMED`. Nothing
signs that the user has not seen (`PRODUCT.md` principle 1).

**Boundary.** This brief documents the **shared families once**. Borrow, Supply,
Watch actions, and Assets **reference these IDs** and do not fork receipt line
schemas. Do not confuse this file with `docs/maps/REVIEW.md` (the agent review
contract).

Bitmap/dither texture is absent from this region. Receipts are token-exact; USD
never appears on committed lines (`UI-SHELL-TOKEN-USD`).

---

## Shared family — SETTLEMENT trace

### `UI-REVIEW-SETTLEMENT-TRACE`

- **ID.** `UI-REVIEW-SETTLEMENT-TRACE`
- **Purpose.** Name the human-readable job stages for the open write, integrated
  into the task (not a detached dock). Vocabulary is SETTLEMENT; the final step
  is `SETTLED`.
- **Visible when.** Any write flow is past its first decision (amount/rate/stream
  chosen) through confirmed.
- **States.** Per step: `done`, `active`, `pending`, `skipped`, `error`. Trace-level:
  `ready`, `wallet-pending`, `chain-pending`, `confirmed`, `stale`.
- **Action.** None — indicator, not navigation. Steps are not clickable shortcuts
  into checkpoints that have not been validated.
- **Copy rules.** Title `SETTLEMENT`. No `JOB STEPS`, no `STEPS`, no console
  language. **Skip-without-renumber:** when an approval is already covered, that
  stage is omitted and remaining stages keep their labels — do not leave a hole
  numbered "2" of 3. First write per wallet inserts `UI-REVIEW-ACKNOWLEDGE-RISK`
  as a stage; it never re-prompts. Stage sequences (approvals omitted when
  covered):
  - Supply: `AMOUNT → APR → APPROVE <underlying> → SUPPLY → SETTLED`
  - Borrow: `STREAM → AMOUNT → APPROVE STREAM → BORROW → SETTLED`
  - Claim: `CLAIM → SETTLED`
  - Withdraw: `WITHDRAW → SETTLED`
  - Repay: `AMOUNT → WRAP SHORTFALL? → APPROVE <ovrflo token> → REPAY → SETTLED`
  - Close: `CLOSE → SETTLED`
  - Wrap: `AMOUNT → APPROVE <underlying> → WRAP → SETTLED`
  - Unwrap: `UNWRAP → SETTLED`
  - Stream create: `MARKET → PT AMOUNT → APPROVE PT → APPROVE FEE → DEPOSIT → SETTLED`
- **Data authority.** `on-chain` for whether an allowance/operator is already
  sufficient (skip). `pure-client` for which stage is active. Acknowledgment
  store is `pure-client` per wallet (U6); it never gates reads.

### `UI-REVIEW-ACKNOWLEDGE-RISK`

- **ID.** `UI-REVIEW-ACKNOWLEDGE-RISK`
- **Purpose.** Require one factual acknowledgment before the first write of a
  wallet, without gating reads or re-prompting.
- **Visible when.** This wallet has not acknowledged, and the open flow is about
  to request its first approval or (if no approval) its first signature. Inserted
  into `UI-REVIEW-SETTLEMENT-TRACE` on whichever flow fires first.
- **States.** `required`, `accepted` (unmounts for this wallet thereafter).
- **Action.** `ACKNOWLEDGE RISK` records the acknowledgment locally for this
  address and advances the trace. Link to `/risk` (`UI-FIRST-RUN-RISK`) for the
  full note. No transaction.
- **Copy rules.** `ACKNOWLEDGE RISK`. Point at `/risk`; do not paste the whole
  note into the trace. Never "I accept liquidation risk". Never re-prompt after
  accepted. Never block watching, quoting, or disconnected `/risk`.
- **Data authority.** `pure-client` — per-wallet acknowledgment store. Not
  on-chain. Not a projection.

---

## Shared family — PERMISSION receipt

### `UI-REVIEW-PERMISSION-RECEIPT`

- **ID.** `UI-REVIEW-PERMISSION-RECEIPT`
- **Purpose.** Show the exact allowance or operator grant the next signature will
  create, before that signature.
- **Visible when.** The active SETTLEMENT stage is an approval. Ghosted (readable,
  not current) on later stages so the grant stays inspectable.
- **States.** `current`, `ghosted`, `skipped` (already covered — the stage was
  omitted; this receipt does not render).
- **Action.** None. The signature itself is `UI-REVIEW-APPROVE`.
- **Copy rules.** Heading `PERMISSION RECEIPT`. Lines are token-exact always:
  token or NFT, spender or operator, exact amount or `SINGLE STREAM` scope,
  `MATCH EXACT`. No USD. No unlimited approval unless the copy says so — this
  product does not request unlimited ERC-20 allowances. Deposit fee approval
  shows **current fee** and **bounded approval** (existing 2% buffer) as two
  lines, never as one collapsed number. Borrow has no ERC-20 fee approval; its
  permission receipt is the Sablier NFT (stream id, operator = lending market,
  `SINGLE STREAM`).
- **Data authority.** `on-chain` for current allowance/operator and for the
  spender/operator addresses. Exact amount is the reviewed amount (`pure-client`
  latch of an `on-chain`-bounded value). See-equals-sign: the receipt amount and
  operator must match built calldata.

---

## Shared family — ACTION receipt

### `UI-REVIEW-ACTION-RECEIPT`

- **ID.** `UI-REVIEW-ACTION-RECEIPT`
- **Purpose.** Show the exact action that will be signed, then the actuals that
  were signed.
- **Visible when.** From review onward. Ghosted during permission stages; current
  at sign; filled from logs after confirm.
- **States.** `ghosted`, `frozen-review` (numbers latched), `wallet-pending`,
  `chain-pending` (hash visible, safe to navigate away), `confirmed` (actuals),
  `reverted`, `error`.
- **Action.** None. Signing is `UI-REVIEW-CONFIRM`.
- **Copy rules.** Heading `ACTION RECEIPT`. Token-exact committed lines; no USD.
  Name every asset. After confirm, round nothing away between quoted and
  received. Partial fills report actual gross/fee/net. Never claim success before
  the receipt. Never describe obligation as liquidation-prone debt.
- **Data authority.** `on-chain` for simulation at review and for decoded logs at
  confirm. Frozen review snapshot is a `pure-client` latch of those on-chain
  facts; drift returns through `UI-REVIEW-STALE`, never silent resubmit.

---

## Shared chrome for every write

### `UI-REVIEW-SPLIT`

- **ID.** `UI-REVIEW-SPLIT`
- **Purpose.** Hold facts on one side and SETTLEMENT + receipts on the other so
  the obligation is visible beside the trace.
- **Visible when.** A flow is on review or a later checkpoint.
- **States.** `review`, `checkpoint`, `confirmed`.
- **Action.** None — layout.
- **Copy rules.** No texture behind text. Gold marks only the active SETTLEMENT
  stage (leading marker, not gold-on-paper body text).
- **Data authority.** `pure-client` layout.

### `UI-REVIEW-APPROVE`

- **ID.** `UI-REVIEW-APPROVE`
- **Purpose.** Grant the exact allowance or stream operator the action needs, as a
  separate visible step.
- **Visible when.** The flow needs an approval that is not already covered. It
  **replaces** `UI-REVIEW-CONFIRM` until satisfied.
- **States.** `armed`, `signing`, `confirming`, `refreshing`, `refresh-failed`,
  `reverted`, `error`, `zero-first-clearing` (`THIS TOKEN REQUIRES CLEARING ITS
  ALLOWANCE FIRST — APPROVE TWICE`). Two-state guard: submitting + cooldown
  (ethskills Rule 1). Failed approval clears local "approved" bookkeeping.
- **Action.** ERC-20 `approve` of the exact amount (fee approve uses the bounded
  buffer) or Sablier `approve` of the stream to the lending market. Moves no
  principal.
- **Copy rules.** Labels: `APPROVE <underlying>`, `APPROVE PT`, `APPROVE FEE`,
  `APPROVE STREAM`, `APPROVE <ovrflo token>`. This step **never** renders
  `CONFIRMED` — that word is reserved for the action transaction. Never request
  unbounded allowance without saying so (and this product does not).
- **Data authority.** `on-chain` for current allowance/operator. Local approved
  flag is `pure-client` optimism that only hides the button.

### `UI-REVIEW-CONFIRM`

- **ID.** `UI-REVIEW-CONFIRM`
- **Purpose.** Submit the action the ACTION receipt describes.
- **Visible when.** Approvals are covered (or none are needed) and
  `UI-REVIEW-ACKNOWLEDGE-RISK` is not still required.
- **States.** `disabled` (incomplete, stale, wrong chain, degraded reads),
  `armed`, `busy`, `re-confirm` (recoverable race; explicit re-review),
  `confirmed` (stays disabled so the same arguments cannot be submitted twice).
  Four-state action ladder ordering (ethskills Rule 2).
- **Action.** The on-chain write: `supply`, `borrow`, `withdraw`, `claim`,
  `repay`, `close`, `wrap`, `unwrap`, vault `deposit`, or vault maturity `claim`.
  Executor rebuilds calldata and rechecks latched account/chain before every
  wallet prompt (reviewed-action). Material drift returns to review.
- **Copy rules.** Label names the action (`SUPPLY`, `BORROW`, `CLAIM`, `REPAY`,
  `CLOSE FROM STREAM`, `WRAP`, `UNWRAP`, `DEPOSIT`). Never promise an outcome the
  contract can clamp. Never present confirm as reversible.
- **Data authority.** `on-chain` for every argument and every gate. Projection
  never authorises.

### `UI-REVIEW-TX-STATE`

- **ID.** `UI-REVIEW-TX-STATE`
- **Purpose.** Report exactly where a submitted transaction is, and distinguish
  the ways it can fail.
- **Visible when.** Every write flow, beneath the active signature control.
- **States.** All distinct: `signing`, `confirming` (truncated hash), `refreshing`,
  `refresh-failed` (`TRANSACTION CONFIRMED — REFRESH FAILED` plus `RETRY REFRESH`),
  `confirmed`, `needs-review`, `reverted` (`TRANSACTION REVERTED ON-CHAIN`),
  `error` (decoded copy + one recovery action). A rejected signature is not a
  revert. Confirmed-but-refresh-failed is not a failure of the money.
- **Action.** `RETRY REFRESH` re-reads; it submits nothing.
- **Copy rules.** Raw selectors never reach the user. One recovery action.
  `BelowMinimum` on borrow is disambiguated (fill floor vs stream-face floor).
- **Data authority.** `on-chain` — transaction status, receipt, decoded error.

### `UI-REVIEW-STALE`

- **ID.** `UI-REVIEW-STALE`
- **Purpose.** Freeze signing when quote, depth, allowance, or identity moved, and
  force a visible re-review.
- **Visible when.** A live read disagrees with the frozen review, or the wallet /
  chain changed, or event freshness is degraded.
- **States.** `quote-updated`, `inputs-changed`, `degraded-reads` (signing
  disabled; watch interpolation elsewhere keeps moving).
- **Action.** Re-review against refreshed numbers. No silent resubmit.
- **Copy rules.** `QUOTE UPDATED` / `ACTION INPUTS CHANGED — REVIEW AND CONFIRM
  AGAIN`. Show the diff. Stale is not loading and not failed.
- **Data authority.** `on-chain` fresh read vs `pure-client` frozen snapshot.

### `UI-REVIEW-ERROR-BOUNDARY`

- **ID.** `UI-REVIEW-ERROR-BOUNDARY`
- **Purpose.** Contain a crash inside a flow body so the user can still leave.
- **Visible when.** The flow body throws. Header/close stay outside.
- **States.** `caught` — `SOMETHING WENT WRONG` with `TRY AGAIN`, `role="alert"`.
- **Action.** `TRY AGAIN` remounts the body. No transaction.
- **Copy rules.** Never claim the transaction did or did not go through.
- **Data authority.** `pure-client`.

---

## Flow-specific review surfaces

### `UI-REVIEW-BORROW`

- **ID.** `UI-REVIEW-BORROW`
- **Purpose.** Freeze borrow economics: gross, fee, net, obligation, residual,
  maturity, APR, partial-fill status, approximate done-date.
- **Visible when.** `BORROW.REVIEW`.
- **States.** `ready`, `partial-fill`, `sale-equivalence` (full remaining),
  `stale`.
- **Action.** `Review Borrow` latches the snapshot and advances SETTLEMENT.
  `minAcceptable` derives from reviewed net under the reviewed-bounds window.
- **Copy rules.** Same facts as `UI-BORROW-FACTS`, frozen. Sale equivalence when
  applicable. Token symbols live. Cover date `~`.
- **Data authority.** `on-chain` quote/simulation. Latch is `pure-client`.

### `UI-REVIEW-SUPPLY`

- **ID.** `UI-REVIEW-SUPPLY`
- **Purpose.** Freeze position placement: amount, APR, market maturity, ahead,
  unfilled withdrawability, earnings-begin-only-when-filled.
- **Visible when.** `SUPPLY.REVIEW`.
- **States.** `ready`, `stale`.
- **Action.** `Review Supply` latches and advances.
- **Copy rules.** Repeat `EARNINGS BEGIN ONLY WHEN FILLED`. No projected yield.
- **Data authority.** `on-chain`. Latch `pure-client`.

### `UI-REVIEW-CLAIM`

- **ID.** `UI-REVIEW-CLAIM`
- **Purpose.** Review this position's claim: exact discovered claimable and
  contributing loans.
- **Visible when.** Claim launched from `UI-WATCH-CLAIM`.
- **States.** `ready`, `nothing-left` (claimed elsewhere), `stale`.
- **Action.** Confirm submits `claim` for this position's loans only.
- **Copy rules.** Payout is the market's ovrflo token, not underlying. Name
  contributing loan ids. No Claim-All.
- **Data authority.** `on-chain` — `loansOf` / `loanState` re-read at confirm.

### `UI-REVIEW-CLAIM-CONFIRMED`

- **ID.** `UI-REVIEW-CLAIM-CONFIRMED`
- **Purpose.** Say exactly what arrived, and offer exits that are not equivalent.
- **Visible when.** `POSITIONS.CLAIM_CONFIRMED` (watch-surface claim receipt).
- **States.** Two inventory variants, and they must stay distinct:
  - `unwrap-enabled` — wrap reserve covers the claimed amount;
    `UNWRAP TO UNDERLYING` enabled.
  - `reserve-insufficient` — `UNWRAP TO UNDERLYING` disabled; available reserve
    shown; other exits remain readable. Never labelled as a failed claim.
- **Action.** Three explicit next choices:
  1. Unwrap to underlying — vault `unwrap`, 1:1, no allowance, only when reserve
     covers (`UI-REVIEW-UNWRAP` / `UI-ASSETS-UNWRAP`).
  2. Keep the market's ovrflo token — return to the supplied detail.
  3. Claim PT after maturity — vault maturity `claim`; receiving PT is not
     receiving underlying.
  A swap route is offered only when a real configured venue and quote exist; it
  is absent from the base flow.
- **Copy rules.** `RECEIVED <amount> <ovrflo symbol>` with live `symbol()`. Never
  `ovrfloWSTETH` as a constant. Never imply unwrap, keep, and claim-PT pay the
  same asset.
- **Data authority.** `on-chain` — receipt logs, wrap reserve, series expiry.

### `UI-REVIEW-UNWRAP`

- **ID.** `UI-REVIEW-UNWRAP`
- **Purpose.** Review a 1:1 ovrflo-token → underlying exit bounded by wrap
  reserve.
- **Visible when.** `POSITIONS.UNWRAP_REVIEW` or Assets unwrap, and from
  claim-confirmed when unwrap is chosen.
- **States.** `ready`, `reserve-insufficient` (unavailable route, not a failed
  balance), `confirmed` (`RECEIVED <amount> <underlying>`).
- **Action.** One `unwrap(amount)`; no approval checkpoint.
- **Copy rules.** Exact 1:1 amounts, current wrap reserve, destination wallet,
  underlying symbol. Insufficient reserve is not a failed claim and not a failed
  unwrap attempt — the route is unavailable.
- **Data authority.** `on-chain` — wrap reserve and balances.

### `UI-REVIEW-REPAY`

- **ID.** `UI-REVIEW-REPAY`
- **Purpose.** Review a repayment in the market's ovrflo token, remaining
  obligation, whether full repay returns the stream, and the moved cover date.
- **Visible when.** `POSITIONS.REPAY_AMOUNT` onward, launched from
  `UI-WATCH-REPAY`.
- **States.** `amount`, `ready`, `full`, `partial`, `stale`.
- **Action.** `REPAY IN FULL` fills outstanding. Confirm submits `repay`.
- **Copy rules.** Show current approximate cover date and the new one this
  repayment would produce **before any signature** (AE6). Third-party payer note
  when payer ≠ borrower. Token symbol live.
- **Data authority.** `on-chain` outstanding. Cover-date preview derived from
  on-chain schedule + new outstanding; `~` day precision. Preview does not gate.

### `UI-REVIEW-REPAY-PREPARE`

- **ID.** `UI-REVIEW-REPAY-PREPARE`
- **Purpose.** When the wallet lacks enough ovrflo token but holds underlying,
  offer to wrap the additional amount needed and return with the repay amount
  preserved.
- **Visible when.** `POSITIONS.REPAY_PREPARE` — ovrflo-token balance < repay
  amount and underlying balance can cover the gap.
- **States.** `shortfall` (present balance + additional amount needed),
  `wrapping` (hands off to `UI-ASSETS-WRAP-AMOUNT`), `returned`.
- **Action.** `WRAP SHORTFALL` launches wrap; on confirm, returns here with the
  entered repay amount preserved.
- **Copy rules.** State the present balance and the additional amount needed —
  never "shortfall" as a moral failing. Name both tokens via live `symbol()`.
- **Data authority.** `on-chain` — both balances. Entered repay amount is
  `pure-client`.

### `UI-REVIEW-CLOSE`

- **ID.** `UI-REVIEW-CLOSE`
- **Purpose.** Review close-from-stream: derived outstanding vs current
  withdrawable, then sign `close`.
- **Visible when.** Close launched from `UI-WATCH-CLOSE`.
- **States.** `ready`, `not-covered` (must not be reachable if the watch gate is
  honest — if reached, disable and say withdrawable no longer covers), `stale`.
- **Action.** Confirm submits `close`. Residual stream returns to the borrower.
- **Copy rules.** `CLOSE FROM STREAM`. Never "liquidate". Show both numbers.
- **Data authority.** `on-chain` — outstanding and `withdrawableAmountOf`
  re-read.

### `UI-REVIEW-WITHDRAW`

- **ID.** `UI-REVIEW-WITHDRAW`
- **Purpose.** Review withdrawal of exact unfilled capital.
- **Visible when.** Withdraw launched from `UI-WATCH-WITHDRAW`.
- **States.** `ready`, `stale` (unfilled moved).
- **Action.** Confirm submits `withdraw` of the exact refundable unfilled amount.
  Owner-only.
- **Copy rules.** Exact amount and underlying symbol. Unfilled only — never
  withdraw filled capital through this control.
- **Data authority.** `on-chain` — unfilled re-read.

### `UI-REVIEW-WRAP`

- **ID.** `UI-REVIEW-WRAP`
- **Purpose.** Review 1:1 underlying → ovrflo token wrap.
- **Visible when.** `ASSETS.WRAP_AMOUNT` continue, or repay-prepare wrap.
- **States.** `ready`, `stale`.
- **Action.** After exact underlying approval (if needed), submit `wrap`. No
  protocol fee, no stream.
- **Copy rules.** Exact 1:1 amounts, destination wallet. `wrap` charges no fee.
- **Data authority.** `on-chain` — balances and allowance.

### `UI-REVIEW-STREAM-DEPOSIT`

- **ID.** `UI-REVIEW-STREAM-DEPOSIT`
- **Purpose.** Review PT deposit: PT in, ovrflo token to wallet, ovrflo token
  into the new stream, underlying fee, maturity, deposit-cap status.
- **Visible when.** `STREAM.REVIEW`.
- **States.** `ready`, `cap-exceeded`, `stale` (fee moved).
- **Action.** Advances to `APPROVE PT` / `APPROVE FEE` as needed, then vault
  `deposit`.
- **Copy rules.** Name PT, the market's ovrflo token (live `symbol()`), and
  underlying fee separately. Fee receipt shows current fee and bounded approval.
  Cap status named when binding. Never describe deposit as locking collateral at
  liquidation risk.
- **Data authority.** `on-chain` — `previewDeposit`, cap, balances. Fee buffer is
  a documented client policy on top of the on-chain fee.

---

## Region copy rules

1. **Nothing signs that the user has not seen.**
2. **Approval is not the action.** Approval states never render `CONFIRMED`.
3. **Skip-without-renumber** when allowance/operator already covers.
4. **Receipts are token-exact.** No USD on committed lines. Market-driven
   symbols; never treat `ovrfloWSTETH` as a constant.
5. **Every failure mode keeps its own words.** Signing rejection, revert, read
   failure, refresh-after-confirm failure, stale quote, unavailable projection.
6. **Projection never authorises.** Every gate re-reads from chain.
7. **No health factor, liquidation, or engagement mechanic.**
8. **What was simulated is what is submitted.** Drift returns to review.
