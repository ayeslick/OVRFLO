# Region brief — Assets converter + stream creation

**Slug:** `ASSETS` · **Control ID prefix:** `UI-ASSETS-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/action-flow/ConvertFlow.tsx` until U10 lands
`web/app/assets/page.tsx` and `web/components/assets/*`.

**Purpose of the region.** Two utilities, not a fourth dashboard: the 1:1
underlying ↔ ovrflo-token converter (approved three-bay exception) and the PT
deposit that creates a vault stream. Entries: shell nav, borrow's no-stream
state, repay-prepare wrap, any role's position detail, first-run deposit intent.

**Boundary.** Approvals, SETTLEMENT, and receipts are `review.md`
(`UI-REVIEW-WRAP`, `UI-REVIEW-UNWRAP`, `UI-REVIEW-STREAM-DEPOSIT`,
`UI-REVIEW-PERMISSION-RECEIPT`, `UI-REVIEW-ACTION-RECEIPT`). Borrow after a new
stream is `borrow.md`.

---

## `UI-ASSETS-CONVERTER`

- **ID.** `UI-ASSETS-CONVERTER`
- **Purpose.** Convert underlying and the market's ovrflo token 1:1, with the
  tracked wrap reserve visible as the unwrap bound.
- **Visible when.** `/assets` is open, or wrap/unwrap is launched in context
  (repay-prepare, claim-confirmed unwrap, watch detail).
- **States.** `wrap`, `unwrap`, `loading-reserve`, `unavailable`.
- **Action.** None itself — children take amounts. Switching direction is
  client-side.
- **Copy rules.** Three-bay geometry: reserve bay, wrap/unwrap center with
  deterministic `OUTPUT`, ovrflo-token bay. Name tokens via live `symbol()` of
  the chosen market's underlying and ovrflo token. Before a market is chosen,
  say "the market's ovrflo token" / "the market's underlying". Never a swap
  rate, never a fee on wrap/unwrap.
- **Data authority.** `on-chain` — balances, `wrappedUnderlying` reserve, market
  symbols. `pure-client` for direction.

## `UI-ASSETS-RESERVE`

- **ID.** `UI-ASSETS-RESERVE`
- **Purpose.** Show wallet balances and the tracked wrap reserve, and state the
  reserve rule: unwrap cannot exceed reserve.
- **Visible when.** The converter is open.
- **States.** `ready`, `loading` (never zero), `unavailable`, `empty-reserve`
  (reserve is genuinely zero after a successful read).
- **Action.** None.
- **Copy rules.** Reserve is a vault accounting figure, not the user's balance.
  Empty reserve disables unwrap (`UI-ASSETS-UNWRAP`) and is not a failed user
  balance. Direct transfers to the vault do not increase wrap reserve — do not
  imply they do.
- **Data authority.** `on-chain` — `OVRFLO.wrappedUnderlying()` and token
  `balanceOf`. The reserve is a gate, so it is never inferred from a token
  balance or a projection.

## `UI-ASSETS-WRAP-AMOUNT`

- **ID.** `UI-ASSETS-WRAP-AMOUNT`
- **Purpose.** Take the underlying amount to wrap 1:1 into the market's ovrflo
  token.
- **Visible when.** `ASSETS.WRAP_AMOUNT` (converter wrap direction, or
  repay-prepare wrap).
- **States.** `empty`, `valid`, `invalid` (insufficient underlying, bad decimals),
  `max` (exact wallet underlying).
- **Action.** Continue opens `UI-REVIEW-WRAP` → optional
  `UI-REVIEW-PERMISSION-RECEIPT` (exact underlying to the vault) → `wrap`.
- **Copy rules.** Exact `underlying → ovrflo token` 1:1, destination wallet.
  `wrap` charges no protocol fee and creates no stream. `OUTPUT` is deterministic
  1:1, not a quote.
- **Data authority.** `pure-client` for the entered string. `on-chain` for
  underlying balance and allowance.

## `UI-ASSETS-UNWRAP`

- **ID.** `UI-ASSETS-UNWRAP`
- **Purpose.** Exit ovrflo token 1:1 into underlying, bounded by wrap reserve,
  before series maturity.
- **Visible when.** Converter unwrap direction, claim-confirmed unwrap, or watch
  detail unwrap, **and** the market has not matured. After maturity this control
  is **removed** and `UI-ASSETS-CLAIM-PT` replaces it.
- **States.**
  - `enabled` — ovrflo-token balance > 0 and reserve covers the requested amount.
  - `disabled-reserve` — reserve insufficient; available reserve shown;
    unavailable route, not a failed unwrap and not a failed claim.
  - `disabled-balance` — no ovrflo token.
  - `absent` — matured.
- **Action.** Opens `UI-REVIEW-UNWRAP`. One `unwrap(amount)`; no approval.
- **Copy rules.** Name the reserve when it is the binding constraint. Unwrap
  returns underlying; claim-PT returns PT — never present them as interchangeable.
- **Data authority.** `on-chain` — ovrflo-token balance, wrap reserve, expiry.

## `UI-ASSETS-CLAIM-PT`

- **ID.** `UI-ASSETS-CLAIM-PT`
- **Purpose.** After series maturity, burn ovrflo token 1:1 for PT.
- **Visible when.** A wallet is connected **and** the chosen market has matured.
  It replaces unwrap on the ovrflo-token bay.
- **States.** `enabled` (balance > 0), `disabled-balance`, `absent` (pre-maturity).
- **Action.** Opens review and submits `OVRFLO.claim(ptToken, amount)`. Bounded by
  PT backing.
- **Copy rules.** `CLAIM PT`. Receiving PT is not receiving underlying; redemption
  from PT to underlying happens through Pendle/SY outside this control. No
  deadline, no forfeiture.
- **Data authority.** `on-chain` — ovrflo-token balance, expiry, PT backing.

## `UI-ASSETS-OUTPUT`

- **ID.** `UI-ASSETS-OUTPUT`
- **Purpose.** Show the deterministic 1:1 output of the converter direction.
- **Visible when.** The converter has an entered amount.
- **States.** `ready` (1:1), `empty`, `invalid` (mirrors the amount field).
- **Action.** None.
- **Copy rules.** `OUTPUT`. Equal to input in token units. Never a rate. Symbols
  from live `symbol()`.
- **Data authority.** The typed amount is `pure-client`. The 1:1 ratio is the
  on-chain wrap/unwrap invariant, not an oracle quote and not a projection.

## `UI-ASSETS-STREAM-SELECT-MARKET`

- **ID.** `UI-ASSETS-STREAM-SELECT-MARKET`
- **Purpose.** Choose which approved series to deposit PT into, creating ovrflo
  token plus a Sablier stream.
- **Visible when.** `STREAM.SELECT_MARKET`.
- **States.** `loading`, `ready`, `empty`, `unavailable`, `selected`.
- **Action.** Continue to `UI-ASSETS-STREAM-ENTER-PT`.
- **Copy rules.** Name series, underlying, maturity. The deposit "mints the
  market's ovrflo token" — never a hardcoded `ovrfloWSTETH`.
- **Data authority.** `on-chain` — factory registry and series info.

## `UI-ASSETS-STREAM-ENTER-PT`

- **ID.** `UI-ASSETS-STREAM-ENTER-PT`
- **Purpose.** Take the PT amount to deposit.
- **Visible when.** `STREAM.ENTER_PT`.
- **States.** `empty`, `valid`, `invalid` (balance, cap, minimum, decimals),
  `max`.
- **Action.** Continue opens `UI-REVIEW-STREAM-DEPOSIT`.
- **Copy rules.** Label `PT`. Cap status when binding. PT is 18 decimals.
- **Data authority.** `pure-client` for the string. `on-chain` for PT `balanceOf`,
  deposit cap, `previewDeposit`.

## `UI-ASSETS-STREAM-CONFIRMED`

- **ID.** `UI-ASSETS-STREAM-CONFIRMED`
- **Purpose.** Identify the created stream and offer the borrow route.
- **Visible when.** `STREAM.CONFIRMED`.
- **States.** One: `confirmed`.
- **Action.** `BORROW AGAINST THIS STREAM` enters `BORROW.ENTER_AMOUNT` with
  stream context preserved. `VIEW STREAM` selects it on the watch wall
  (`?lens=streams&stream=`).
- **Copy rules.** Name stream id, amounts (PT in, ovrflo token to wallet, ovrflo
  token in stream, fee), maturity. Live symbols.
- **Data authority.** `on-chain` — deposit receipt logs.

---

## Region copy rules

1. **Wrap and unwrap are 1:1 and fee-less.** Never a swap, never a rate.
2. **Reserve-insufficient unwrap is an unavailable route**, not a failed claim
   and not a failed balance.
3. **Claim PT and unwrap pay different assets.**
4. **Token symbols are market-driven.** Before a market is chosen, say "the
   market's ovrflo token".
5. **No health factor or liquidation framing** on deposit or wrap.
6. Stream-create approvals and receipts are the shared REVIEW families; skip
   without renumbering when allowances already cover.
