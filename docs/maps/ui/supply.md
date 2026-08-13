# Region brief — Supply flow

**Slug:** `SUPPLY` · **Control ID prefix:** `UI-SUPPLY-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/action-flow/SupplyFlow.tsx` until U8 lands
`web/app/supply/page.tsx` and `web/components/supply/*`.

**Purpose of the region.** Choose one market and one fixed APR tick, append
underlying liquidity, and create one lender position. Liquidity rests until
matched; earnings begin only when filled.

**Boundary.** Review, approvals, signatures, pending, and confirmed receipts are
`review.md`. The full ladder is `rates.md`. A confirmed supply appears on the
watch wall as a resting row (`watch.md`).

Flow: `SUPPLY.SELECT_MARKET → ENTER_AMOUNT → SELECT_RATE → REVIEW → APPROVE →
SIGN → PENDING → CONFIRMED`.

---

## `UI-SUPPLY-SELECT-MARKET`

- **ID.** `UI-SUPPLY-SELECT-MARKET`
- **Purpose.** Choose which approved, active, pre-maturity PT market to supply
  into.
- **Visible when.** `SUPPLY.SELECT_MARKET`.
- **States.**
  - `loading` — registry read in flight; not "no markets".
  - `ready` — approved active markets: underlying, maturity, number of live APR
    ticks, best available depth.
  - `empty` — confirmed zero approved active pre-maturity markets.
  - `unavailable` — registry read failed.
  - `selected` — one market chosen.
- **Action.** Client-side selection. Continue advances to amount. A market that
  matures or deactivates mid-flow returns here (`UI-SUPPLY-MARKET-UNAVAILABLE`)
  and keeps the amount if it still applies.
- **Copy rules.** Name underlying via live `symbol()` / series info. Maturity as a
  date. Never show TVL as the reason to pick a market. `ovrfloWSTETH` is an
  example in docs only, never copy in this control.
- **Data authority.** `on-chain` — factory registry, per-market `symbol()`, series
  expiry, `tickDepths` for live-tick count and best depth.

## `UI-SUPPLY-MARKET-UNAVAILABLE`

- **ID.** `UI-SUPPLY-MARKET-UNAVAILABLE`
- **Purpose.** Explain why the previously selected market can no longer take
  supply, without silently moving the order to another market.
- **Visible when.** The selected market matured, deactivated, or its tick
  configuration changed such that the chosen APR is no longer valid.
- **States.** `matured-or-inactive`, `tick-config-changed`.
- **Action.** Returns to `UI-SUPPLY-SELECT-MARKET` (maturity/inactive) or
  `UI-SUPPLY-RATE-WINDOW` (tick config), keeping amount when possible. Never
  silently retarget another APR.
- **Copy rules.** Name the market and the reason. Never "we picked a better rate
  for you".
- **Data authority.** `on-chain` — series expiry, market activity, current
  `tickSpacing` / bounds.

## `UI-SUPPLY-AMOUNT`

- **ID.** `UI-SUPPLY-AMOUNT`
- **Purpose.** Take how much underlying to supply, bounded by wallet balance and
  the protocol minimum.
- **Visible when.** `SUPPLY.ENTER_AMOUNT` (and still visible beside rate).
- **States.**
  - `empty` — placeholder `0.00`.
  - `valid` — nonzero, unit-aligned, above `MIN_LIQUIDITY_AMOUNT`, within balance.
  - `invalid` — inline error: below minimum, unaligned, or insufficient balance.
  - `max` — `MAX` fills the exact wallet balance.
  - `loading-balance` — balance unread; `MAX` disabled; not shown as `0`.
- **Action.** Client-side. Submits nothing.
- **Copy rules.** Label names the underlying symbol from the chosen market's live
  `symbol()` path (underlying token, not the ovrflo token). Exact `MAX`. Inline
  unit and minimum feedback. `inputmode="decimal"`; never block paste.
- **Data authority.** `pure-client` for the entered string. `on-chain` for wallet
  `balanceOf` and `MIN_LIQUIDITY_AMOUNT`.

## `UI-SUPPLY-RATE-WINDOW`

- **ID.** `UI-SUPPLY-RATE-WINDOW`
- **Purpose.** Choose the fixed APR tick at which liquidity will rest.
- **Visible when.** Amount is valid enough to pick a rate, or always beside amount
  once a market is chosen.
- **States.** `loading`, `ready` (three contextual ticks plus queue-ahead per
  tick), `empty` (no configured ticks — should not happen on an active market;
  treat as unavailable, not as "supply at 0%"), `unavailable`.
- **Action.** Client-side tick selection.
- **Copy rules.** Show existing unfilled amount ahead at the selected tick.
  Neighboring-tick hints visible. Never present ahead as expected time-to-fill.
- **Data authority.** `on-chain` — `tickDepths`, bounds, spacing. `pure-client` for
  selection.

## `UI-SUPPLY-STEPPER`

- **ID.** `UI-SUPPLY-STEPPER`
- **Purpose.** Move the three-tick window one configured tick at a time.
- **Visible when.** `UI-SUPPLY-RATE-WINDOW` is showing.
- **States.** `enabled`, `disabled-min` (`LOWEST CONFIGURED APR`), `disabled-max`
  (`HIGHEST CONFIGURED APR`). Plain labeled buttons, not a spinbutton.
- **Action.** Instant window shift from the one-read ladder. No transaction.
- **Copy rules.** Disabled reason visible. No wrap from max to min.
- **Data authority.** `on-chain` for bounds. `pure-client` for window position.

## `UI-SUPPLY-ALL-RATES`

- **ID.** `UI-SUPPLY-ALL-RATES`
- **Purpose.** Open the full ladder for a direct pick.
- **Visible when.** The rate window is showing.
- **States.** `idle`, `open` (hosts `rates.md` in supply context).
- **Action.** A pick writes the tick back into `UI-SUPPLY-RATE-WINDOW` and closes.
- **Copy rules.** `ALL RATES`.
- **Data authority.** `pure-client` for open/closed.

## `UI-SUPPLY-QUEUE-BAND`

- **ID.** `UI-SUPPLY-QUEUE-BAND`
- **Purpose.** Show the position's literal place in the selected tick's unfilled
  queue — capital that will rest behind what is already ahead.
- **Visible when.** A tick is selected and an amount is entered.
- **States.** `ready` (ahead + this order), `empty-ahead` (nothing ahead),
  `loading`, `unavailable`.
- **Action.** None. `role="meter"` + `aria-valuetext`.
- **Copy rules.** Queue position is an amount ahead, not a wait-time estimate.
  Unfilled is withdrawable until filled — say so. Never animate a resting queue
  as if it were earning.
- **Data authority.** `on-chain` — unfilled ahead at the tick from `tickDepths` /
  tree prefix. Entered amount is `pure-client`.

## `UI-SUPPLY-FACTS`

- **ID.** `UI-SUPPLY-FACTS`
- **Purpose.** State amount, APR, market maturity, currently ahead, unfilled
  withdrawability, and that earnings begin only when filled — before review.
- **Visible when.** Market, amount, and tick are selected.
- **States.** `idle`, `ready`, `loading`, `unavailable`.
- **Action.** None. Continue opens `UI-REVIEW-SUPPLY`.
- **Copy rules.** Explicit: `EARNINGS BEGIN ONLY WHEN FILLED`. Resting capital
  does not tick. Token symbols from live reads. No projected APY, no utilisation
  forecast.
- **Data authority.** `on-chain` for market/tick facts. Derived display of "ahead"
  from those reads.

---

## Region copy rules

1. **Earnings begin only when filled.** Resting copy is inert. Never invent an
   accrual preview on unfilled capital.
2. **Tick configuration changes return to rate select.** Never silently move
   liquidity to another APR.
3. **Stepper paddles disable with reason at `aprMin` / `aprMax`.**
4. **Token symbols are market-driven.** Underlying for the amount field; the
   market's ovrflo token only where the position later claims in that token.
5. **No health factor, liquidation, or engagement mechanic.**
6. Review / approve / sign / confirmed are `UI-REVIEW-SUPPLY`,
   `UI-REVIEW-PERMISSION-RECEIPT`, `UI-REVIEW-ACTION-RECEIPT`,
   `UI-REVIEW-SETTLEMENT-TRACE`. Approval is skipped-not-renumbered when allowance
   already covers the exact amount.
