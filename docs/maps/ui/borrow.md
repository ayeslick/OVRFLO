# Region brief — Borrow flow

**Slug:** `BORROW` · **Control ID prefix:** `UI-BORROW-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/action-flow/BorrowFlow.tsx` until U9 lands
`web/app/borrow/page.tsx` and `web/components/borrow/*`.

**Purpose of the region.** Pledge one eligible Sablier stream, choose one fixed APR
tick, receive underlying, and create one loan. Spacious single-decision composition;
the dense ladder lives behind `ALL RATES` (`rates.md`).

**Boundary.** Review, approvals, signatures, pending, and confirmed receipts are
`review.md` — this brief references those IDs and does not duplicate them. Stream
creation for a wallet with no eligible stream hands off to `assets.md` /
`first-run.md`. Watch launches this flow via `UI-WATCH-BORROW-ROUTE`.

Flow: `BORROW.SELECT_STREAM → ENTER_AMOUNT + SELECT_RATE → REVIEW → APPROVE_STREAM →
SIGN → PENDING → CONFIRMED`.

---

## `UI-BORROW-SELECT-STREAM`

- **ID.** `UI-BORROW-SELECT-STREAM`
- **Purpose.** Choose which eligible, unpledged, transferable vault-created stream to
  pledge.
- **Visible when.** `BORROW.SELECT_STREAM` — the flow opened without a stream, or the
  user chose `CHANGE` from `UI-BORROW-STREAM-CONTEXT`.
- **States.**
  - `loading` — discovery or hydration in flight; not an empty list.
  - `ready` — list of eligible unpledged streams: remaining amount, source series,
    maturity, pledge status.
  - `empty` — confirmed zero eligible streams; replaced by `UI-BORROW-NO-STREAM`.
  - `unavailable` — discovery could-not-ask; not empty.
  - `selected` — one stream chosen; continue enabled.
- **Action.** Client-side selection. Continue advances to amount+rate. Changing
  selection resets quote and stale-recovery — a terminal error is terminal for the
  stream, not the form.
- **Copy rules.** Options show stream id and remaining value in the market's ovrflo
  token (`symbol()` once the stream's market is known; otherwise "the market's ovrflo
  token"). Never list a stream that fails the eligibility mirror (sender is a
  registered vault and asset is that market's ovrflo token) or that is already
  pledged.
- **Data authority.** `projection` for the candidate set. `on-chain` for `ownerOf`,
  `getStream`, remaining, and pledged status. Continue does not authorise the borrow;
  `requireEligible` is re-read at review/sign.

## `UI-BORROW-NO-STREAM`

- **ID.** `UI-BORROW-NO-STREAM`
- **Purpose.** Explain that Borrow requires an eligible OVRFLO-created stream, and
  hand off to creating one — never a disabled transaction form.
- **Visible when.** Stream list is confirmed empty of eligible unpledged streams.
- **States.** One: `empty-eligible`. Distinct from `unavailable` on
  `UI-BORROW-SELECT-STREAM`.
- **Action.** Routes into stream creation (`UI-ASSETS-STREAM-SELECT-MARKET`) or
  first-run's deposit intent when the wallet is otherwise protocol-empty.
- **Copy rules.** Borrow requires an eligible, transferable OVRFLO-created Sablier
  stream. Do not show a greyed amount field. Do not invent a demonstration stream.
- **Data authority.** `on-chain` for the confirmed-empty hydration result.
  `projection` incompleteness must not reach this control (that is `unavailable` on
  the selector).

## `UI-BORROW-STREAM-CONTEXT`

- **ID.** `UI-BORROW-STREAM-CONTEXT`
- **Purpose.** Keep the pledged stream visible while amount and rate are decided.
- **Visible when.** A stream is selected (`BORROW.ENTER_AMOUNT + SELECT_RATE` and
  later, until confirmed).
- **States.** `ready`, `stale` (stream facts as-of; signing blocked until refresh).
- **Action.** `CHANGE` returns to `UI-BORROW-SELECT-STREAM` and preserves the entered
  amount when it still fits the new stream's cap; otherwise it clears the amount.
- **Copy rules.** `← CHANGE STREAM` is ink with underline, not a gold CTA. Show
  remaining, maturity, repay capacity. Token symbol from live `symbol()`.
- **Data authority.** `on-chain` — `getStream` and remaining face.

## `UI-BORROW-AMOUNT`

- **ID.** `UI-BORROW-AMOUNT`
- **Purpose.** Take how much underlying is wanted now, bounded by the stream-derived
  cap, not by wallet balance.
- **Visible when.** `BORROW.ENTER_AMOUNT + SELECT_RATE`.
- **States.**
  - `empty` — placeholder `0.00`.
  - `valid` — nonzero, unit-aligned, within the stream-derived cap.
  - `invalid` — `aria-invalid` plus inline error (below minimum, above cap, bad
    decimals).
  - `max` — `MAX` fills the stream-derived cap. **No wallet-balance line** — a borrow
    is not bounded by anything in the wallet.
- **Action.** Client-side. Changes what review would submit; submits nothing.
- **Copy rules.** Label names underlying. `MAX` is balance-independent. Never label
  the field with the ovrflo token the stream holds. Minimum feedback names
  `MIN_STREAM_AMOUNT` / fill floor in product terms, not raw selectors.
- **Data authority.** `pure-client` for the entered string. `on-chain` for the cap
  (remaining face, pricing params). Wallet underlying balance is not a gate here.

## `UI-BORROW-RATE-WINDOW`

- **ID.** `UI-BORROW-RATE-WINDOW`
- **Purpose.** Choose one live APR tick from a three-tick window, with depth visible
  on each option.
- **Visible when.** Amount is being entered / rate is being selected.
- **States.**
  - `loading` — `tickDepths` in flight; not an empty ladder.
  - `ready` — three contextual ticks; selected tick marked.
  - `empty` — no live depth at any tick; not an error colour.
  - `unavailable` — the depths read failed.
- **Action.** Client-side tick selection. Stepping is `UI-BORROW-STEPPER`. Direct pick
  from the full ladder is `UI-BORROW-ALL-RATES` → `rates.md`.
- **Copy rules.** Chips show APR and available depth in underlying. Hint: lower rate,
  deeper pool — as a factual depth comparison, not advice. Neighboring-tick hints
  visible. Never present depth as a guaranteed fill.
- **Data authority.** `on-chain` — `tickDepths` and `aprMinBps` / `aprMaxBps` /
  `tickSpacing`. `pure-client` for which tick is selected.

## `UI-BORROW-STEPPER`

- **ID.** `UI-BORROW-STEPPER`
- **Purpose.** Move the three-tick window one configured tick at a time.
- **Visible when.** `UI-BORROW-RATE-WINDOW` is showing.
- **States.**
  - `enabled` — a neighbor exists inside `[aprMin, aprMax]`.
  - `disabled-min` — at `aprMin`; paddle disabled with reason
    `LOWEST CONFIGURED APR`.
  - `disabled-max` — at `aprMax`; reason `HIGHEST CONFIGURED APR`.
  - Paddles are plain labeled buttons, not a spinbutton — they page a window, they
    do not edit a value (KTD7).
- **Action.** Instant window shift from the one-read ladder. No RPC. No transaction.
- **Copy rules.** Accessible names `Lower APR` / `Higher APR`. Disabled reason is
  visible, not title-only. Never silently wrap from max to min.
- **Data authority.** `on-chain` for the configured bounds. `pure-client` for window
  position.

## `UI-BORROW-ALL-RATES`

- **ID.** `UI-BORROW-ALL-RATES`
- **Purpose.** Open the full depth ladder for a direct pick.
- **Visible when.** The rate window is showing.
- **States.** `idle`, `open` (hosts `rates.md`).
- **Action.** Opens `UI-RATES-WORKSPACE` in borrow context. A pick writes the
  selected tick back into `UI-BORROW-RATE-WINDOW` and closes the workspace.
- **Copy rules.** `ALL RATES`. Not `ADVANCED`, not `EXPERT`.
- **Data authority.** `pure-client` for open/closed. Ladder data is `on-chain` in
  `rates.md`.

## `UI-BORROW-POOL-BAND`

- **ID.** `UI-BORROW-POOL-BAND`
- **Purpose.** Show the customer's draw against the selected tick's resting
  liquidity, and flag a partial fill before review.
- **Visible when.** A tick is selected and an amount is entered.
- **States.**
  - `fits` — draw ≤ depth.
  - `partial` — draw exceeds depth; overrun marked; copy from
    `UI-BORROW-PARTIAL-FILL`.
  - `empty-tick` — depth is zero; continue blocked; identify other live ticks.
  - `loading` / `unavailable`.
- **Action.** None — `role="meter"` + `aria-valuetext`.
- **Copy rules.** The band is draw vs pool, not a health bar. Gold marks the
  customer's draw. Never colour overrun as liquidation risk.
- **Data authority.** `on-chain` — selected tick depth and the entered amount
  (amount is `pure-client` until review freezes it against a live depth).

## `UI-BORROW-PARTIAL-FILL`

- **ID.** `UI-BORROW-PARTIAL-FILL`
- **Purpose.** Say the target is not guaranteed when draw exceeds depth, and force
  actuals onto review before signing.
- **Visible when.** Entered draw exceeds live depth at the selected tick, or the
  simulation/receipt reports a smaller fill than reviewed.
- **States.** `warning` (pre-sign), `actuals` (re-presented before sign after a
  quote refresh), `receipt` (confirmed fill smaller than target).
- **Action.** None. Signing stays possible against the *actual* gross/fee/net, not
  against the original target.
- **Copy rules.** Never imply the target is guaranteed. Show actual gross, actual
  fee, actual net. `QUOTE UPDATED` when numbers moved (`UI-BORROW-QUOTE-UPDATED`).
- **Data authority.** `on-chain` — live depth and, after simulation, simulated
  fill. Display of the typed target is `pure-client`.

## `UI-BORROW-FACTS`

- **ID.** `UI-BORROW-FACTS`
- **Purpose.** State net proceeds, fee-from-proceeds, obligation, residual stream,
  and approximate done-date before the user opens review.
- **Visible when.** Amount and tick are selected.
- **States.** `idle`, `ready`, `loading`, `unavailable` (failed quote inputs — not
  zero).
- **Action.** None. Continue opens `UI-REVIEW-BORROW`.
- **Copy rules.** Gold `YOU RECEIVE` is net underlying after fee. Fee is deducted
  from `actualBorrow`; it is not pulled from the wallet and needs no ERC-20
  approval. Obligation and residual are in the market's ovrflo token. Done-date
  prefixed `~`. Never a health factor.
- **Data authority.** Derived from `on-chain` pricing params (`StreamPricing`
  mirror in `web/lib/`); verified by simulation at review. Not a gate.

## `UI-BORROW-SALE-EQUIVALENCE`

- **ID.** `UI-BORROW-SALE-EQUIVALENCE`
- **Purpose.** When the draw equals (or is clamped to) the stream's full remaining
  value, say the sale equivalence plainly.
- **Visible when.** Entered or clamped draw equals remaining face value.
- **States.** One: `sale` — visible notice on amount/rate and again on
  `UI-REVIEW-BORROW`.
- **Action.** None.
- **Copy rules.** The stream repays the loan entirely and no residual returns. Do
  not say "sell NFT" as a separate product — lending is loan-only; a maximum borrow
  is economically a sale (`PRODUCT.md`).
- **Data authority.** `on-chain` remaining vs entered amount.

## `UI-BORROW-QUOTE-UPDATED`

- **ID.** `UI-BORROW-QUOTE-UPDATED`
- **Purpose.** Freeze signing when depth or pricing moved, and show a visible diff.
- **Visible when.** A live read disagrees with the frozen review quote.
- **States.** One: `quote-updated` — signing frozen; return to `BORROW.REVIEW`
  (`UI-REVIEW-BORROW`) with `QUOTE UPDATED` diff.
- **Action.** User re-reviews. No silent resubmit.
- **Copy rules.** `QUOTE UPDATED`. Show previous vs current gross/fee/net/depth.
  Never apply the new quote under the old confirmation.
- **Data authority.** `on-chain` — the fresh `tickDepths` / pricing read vs the
  frozen review snapshot (`pure-client` latch).

---

## Region copy rules

1. **No eligible stream → handoff, not a disabled form.**
2. **Partial fill is named before signing.** Target is never guaranteed.
3. **Fee comes from proceeds.** No fee approval step exists on borrow.
4. **Stepper paddles disable with reason at `aprMin` / `aprMax`.** No wrap.
5. **Token symbols are market-driven.** Before a market is known, say "the
   market's ovrflo token".
6. **No health factor, liquidation, or invented APR.** Projection never gates
   the borrow; `requireEligible` and depths are re-read at review/sign.
7. Review / approve / sign / confirmed are `UI-REVIEW-BORROW`,
   `UI-REVIEW-PERMISSION-RECEIPT`, `UI-REVIEW-ACTION-RECEIPT`,
   `UI-REVIEW-SETTLEMENT-TRACE`.
