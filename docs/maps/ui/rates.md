# Region brief — ALL RATES expert workspace

**Slug:** `RATES` · **Control ID prefix:** `UI-RATES-` (`../SCHEMAS.md` §1)

**Incumbent code:** none after U1 retired `RateLadder.tsx`. U4 lands `RateWindow`;
U8/U9 host this workspace from Borrow and Supply.

**Purpose of the region.** The dense full-depth ladder behind `ALL RATES`: every
configured tick, live depth (borrow) or unfilled-ahead (supply), for a direct
pick. Three-bay geometry is retained here (and in the Assets converter) as the
approved exception to spacious single-decision defaults.

**Boundary.** The three-tick window and paddles stay in `borrow.md` /
`supply.md`. This region does not submit a transaction. A pick returns to the
calling flow's window. Review remains `review.md`.

---

## `UI-RATES-WORKSPACE`

- **ID.** `UI-RATES-WORKSPACE`
- **Purpose.** Contain the full ladder as a focused workspace on top of Borrow or
  Supply without destroying the caller's amount and stream/market context.
- **Visible when.** `UI-BORROW-ALL-RATES` or `UI-SUPPLY-ALL-RATES` is `open`.
- **States.** `borrow-context`, `supply-context`. Escape / close returns to the
  caller with selections preserved.
- **Action.** Close via `UI-RATES-CLOSE` or a successful pick. Submits nothing.
- **Copy rules.** Heading `ALL RATES`. Name the calling flow (Borrow or Supply)
  and the token the depths are denominated in — underlying, live `symbol()`.
  Bitmap texture may appear in this dense workspace; it stays off Review/receipt
  surfaces.
- **Data authority.** `pure-client` for which flow opened it. Ladder contents are
  `on-chain` via `UI-RATES-LADDER`.

## `UI-RATES-LADDER`

- **ID.** `UI-RATES-LADDER`
- **Purpose.** Enumerate every configured tick in `[aprMin, aprMax]` at
  `tickSpacing`.
- **Visible when.** The workspace is open.
- **States.**
  - `loading` — `tickDepths` in flight; not an empty book.
  - `ready` — one row per tick.
  - `unavailable` — the read failed; not empty.
  - `empty` — no ticks configured (treat as unavailable on an active market).
- **Action.** None itself — rows are `UI-RATES-ROW`. It is a `radiogroup`: one tab
  stop, arrows/Home/End move and select.
- **Copy rules.** Borrow rows: APR, available depth in underlying. Supply rows:
  APR, unfilled ahead. Never a demand forecast, never utilisation. Depth is not a
  guaranteed fill.
- **Data authority.** `on-chain` — one `tickDepths(market)` view returns every
  rung. Bounds and spacing are `on-chain` book constants.

## `UI-RATES-ROW`

- **ID.** `UI-RATES-ROW`
- **Purpose.** Pick one tick directly.
- **Visible when.** The ladder is `ready`.
- **States.** `idle`, `selected` (`aria-checked`), `no-depth` (borrow: zero depth;
  still selectable so the caller can see it, but the caller's continue stays
  blocked until a live tick is chosen).
- **Action.** Writes the tick into the calling flow's rate window and closes the
  workspace. No transaction.
- **Copy rules.** APR as configured bps, not a slider. Borrow depth excludes
  nothing the contract would fill — v1-lite has no self-match guard on blind fill;
  do not print a "your own supply excluded" footnote that the contract does not
  enforce. (Critical pattern #4: self-fill is self-neutral minus fee; the UI must
  not invent a block.)
- **Data authority.** `on-chain` for the row's depth. `pure-client` for selection.

## `UI-RATES-CLOSE`

- **ID.** `UI-RATES-CLOSE`
- **Purpose.** Return to the three-tick window without changing the caller's tick
  if the user did not pick.
- **Visible when.** The workspace is open.
- **States.** One: enabled. Escape is equivalent.
- **Action.** Closes. If no pick occurred, the caller's previously selected tick
  stands.
- **Copy rules.** `Close`. Not `Cancel order` — no order has been submitted.
- **Data authority.** `pure-client`.

## `UI-RATES-EMPTY`

- **ID.** `UI-RATES-EMPTY`
- **Purpose.** Distinguish "no live depth at any tick" (borrow) from a failed
  read.
- **Visible when.** Borrow context and every rung's depth is zero, after a
  successful `tickDepths` read.
- **States.** One: `no-live-depth`. Distinct from `UI-RATES-LADDER` `unavailable`.
- **Action.** None. The caller keeps amount and stream and stays on rate select
  (`borrow.md` exception: identify other live ticks — here there are none, so the
  copy says so).
- **Copy rules.** `NO LIQUIDITY POSTED AT ANY RATE`. Not an error colour. Not
  "market dead". Not empty-as-failed-read.
- **Data authority.** `on-chain` — a successful depths read whose every rung is
  zero.

---

## Region copy rules

1. **This workspace does not sign.** A pick is a selection.
2. **One `tickDepths` read feeds the whole ladder.** Stepping in the caller is
   instant because the data is already here.
3. **No invented self-match exclusion** on borrow depth.
4. **Token symbols are market-driven.** Depths are underlying.
5. **No health factor, utilisation heatmap, or demand forecast.**
