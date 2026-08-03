# Region brief — Self-repaying markets table

**Slug:** `MARKETS-TABLE` · **Control ID prefix:** `UI-MARKETS-TABLE-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/MarketsTable.tsx` (table, `RatesCell`, registry status
and truncation copy, expanded-row host)

**Purpose of the region.** List every approved market with the four facts that drive the
deposit / supply / borrow decision — asset, maturity, size, live rate range — and let the
user open exactly one market at a time.

**Boundary.**

- The table renders the **aggregate** rates cell only. The interactive tick ladder
  (`RateLadder`) is not rendered by this region at all: it renders inside the borrow,
  supply, and adjust-rate flows, and is documented as `UI-ACTION-RATE-LADDER` in
  `action.md`. `../README.md` and `ui/README.md` list `RateLadder.tsx` as incumbent code
  for this region; that mapping is inherited from the charter and does not match where the
  component renders. Treat `action.md` as the ladder's brief.
- The expanded row's contents belong to `settlement.md`; this region owns only the toggle
  and the fact that at most one row is expanded.
- Row-level position cards belong to `positions.md`.

**Initial-view constraint.** The table is aggregate-only. No historical scan and no
account-scoped candidate hydration runs until the user opens a market or explicitly loads
positions (`UI-POSITIONS-LOAD`). Adding a per-row personal figure would break that.

---

## `UI-MARKETS-TABLE-ROW-TOGGLE`

- **ID.** `UI-MARKETS-TABLE-ROW-TOGGLE`
- **Purpose.** Open one market's settlement detail, and close it again.
- **Visible when.** One per rendered market row; rows render whenever the registry
  returned at least one market.
- **States.**
  - `collapsed` — `▸ <ovrfloSymbol>`, `aria-expanded="false"`.
  - `expanded` — `▾ <ovrfloSymbol>`, `aria-expanded="true"`, and the row carries
    `row-expanded`.
  - At most one row is expanded: selecting another market replaces the selection rather
    than adding to it.
  - Reset on signer change: `MarketsApp` clears the selection when the connected address
    changes, because the expanded row's balances and positions describe a different
    account.
- **Action.** Client-side only — sets or clears `selectedMarket`, which mounts the
  expanded detail (`settlement.md`) as a sibling **below** the table, not as a table row.
  No transaction. `aria-expanded` lives on the button, not on the `<tr>`; the `row` role
  does not permit it outside a treegrid.
- **Copy rules.** The row label is the market's ovrfloToken symbol. Do not add a status
  badge to the row that the region cannot substantiate ("healthy", "at risk", "safe") —
  markets have no such state, and a row-level risk badge is exactly the generative-comp
  artefact that must not ship.
- **Data authority.** `on-chain` for the market identity and symbol. `pure-client` for
  which row is expanded.

## `UI-MARKETS-TABLE-MATURITY`

- **ID.** `UI-MARKETS-TABLE-MATURITY`
- **Purpose.** Show when the series matures and how much term remains, because
  time-to-maturity is what makes an APR comparable to an upfront percentage.
- **Visible when.** Every rendered market row.
- **States.**
  - `pre-hydration` — server/first client render has no clock (`useNowSecondsHydrationSafe`
    returns `null`); the countdown is not asserted.
  - `live` — `<maturity date>` plus a countdown of the remaining term.
  - `matured` — remaining seconds clamp to zero; the countdown reads as elapsed rather than
    negative.
- **Action.** None — display only.
- **Copy rules.** The countdown is days **and** hours, not days alone — days alone hid up
  to 23 hours of remaining term, which changes the upfront math. Maturity is a series fact,
  not a deadline the user must act before to avoid loss: nothing is liquidated at maturity.
  What actually changes at maturity is documented per control in `settlement.md` (deposit
  and supply close; claim-PT opens).
- **Data authority.** `on-chain` for `expiryCached` (read from the vault's series record).
  `pure-client` for the render clock.

## `UI-MARKETS-TABLE-TVL`

- **ID.** `UI-MARKETS-TABLE-TVL`
- **Purpose.** Show how much PT has been deposited into this market, as a size signal.
- **Visible when.** Every rendered market row.
- **States.**
  - `unknown` — the per-market read has not succeeded; the amount formatter renders the
    unknown form rather than `0`.
  - `ready` — `marketTotalDeposited` formatted against the **underlying** symbol.
  - A failed read must not render as zero. Zero deposits and an unread market look nothing
    alike to a user deciding where to supply.
- **Action.** None — display only.
- **Copy rules.** Column header `TVL`. No fiat conversion. Do not annotate it with a
  utilisation percentage or capacity bar unless the number behind it is read and can also
  report unknown.
- **Data authority.** `on-chain` — `OVRFLO.marketTotalDeposited(market)` via multicall.

## `UI-MARKETS-TABLE-RATES`

- **ID.** `UI-MARKETS-TABLE-RATES`
- **Purpose.** Show the market's live rate range in both lenses at once — lender APR and
  borrower upfront percentage — so a user can judge the market before opening it.
- **Visible when.** Every rendered market row.
- **States.** Five, all distinct:
  - `no-lending` — the market has no lending deployment, or the clock has not hydrated:
    `—`.
  - `loading` — lending params or tick depths in flight: `LOADING`.
  - `unavailable` — a params or depth read errored, or the depth set is not complete for
    every tick: `UNAVAILABLE`. Incomplete is treated as unavailable, never as thin
    liquidity.
  - `empty` — reads complete and **no** tick has depth: `—`.
  - `ready` — `<apr or apr range> APR · <upfront or range> ↑`, taken from the lowest and
    highest liquid ticks.
- **Action.** None — display only. Choosing a tick happens in the action flows.
- **Copy rules.** Every rate is shown in **both** lenses, always: APR is the lender lens,
  upfront percentage is the borrower lens, and they are two views of one deterministic
  per-market conversion, not two products. Never present the range as a prediction, a
  forecast, or a "current best rate" guarantee — it is the live tick range at the read
  block. `UNAVAILABLE` must never be softened into `—`, and `—` must never be used for a
  failed read.
- **Data authority.** `on-chain` — lending params (`aprMinBps`, `aprMaxBps`, `feeBps`) and
  per-tick `marketAprAvailableLiquidity`. The upfront percentage is derived arithmetic over
  those on-chain inputs plus the market's time-to-maturity, so it carries the same domain.

## `UI-MARKETS-TABLE-BODY-STATE`

- **ID.** `UI-MARKETS-TABLE-BODY-STATE`
- **Purpose.** When there are no rows, say **why** there are no rows.
- **Visible when.** `markets.length === 0`; renders as a single full-width cell.
- **States.** Four distinct messages, in this precedence:
  - `truncated` — `MARKET REGISTRY UNAVAILABLE — DISCOVERY BUDGET EXCEEDED`.
  - `loading` — `LOADING MARKETS`.
  - `unavailable` — `MARKET REGISTRY UNAVAILABLE — RETRY`.
  - `empty` — `NO APPROVED MARKETS`.
  - These four must never collapse into one. "None exist", "not asked yet", "the ask
    failed", and "the ask was too big to complete" are four different claims.
- **Action.** None. The `unavailable` copy names retry as the route but the cell is not
  itself a retry control; a retry affordance would be a new control and a brief amendment.
- **Copy rules.** Never render `NO APPROVED MARKETS` for a failed or truncated registry
  read — that is the single most misleading substitution available in this region. Keep the
  `RETRY` hint attached to the unavailable case only.
- **Data authority.** `on-chain` for the registry reads (factory `approvedMarketCount` /
  `approvedMarketAt`, vault `series`). The status classification itself is `pure-client`
  bookkeeping over those read outcomes, and is never treated as an authority for anything
  beyond what to render.

## `UI-MARKETS-TABLE-TRUNCATION`

- **ID.** `UI-MARKETS-TABLE-TRUNCATION`
- **Purpose.** Disclose that the market list is capped, so a user does not read a partial
  list as the whole market set.
- **Visible when.** `useAllMarkets().tooLarge` — vault enumeration or total market count
  exceeded the enumeration budget. It renders **above** the table, independently of whether
  the body is empty.
- **States.** One: rendered, as `status-negative`, reading
  `COMPLETE MARKET REGISTRY UNAVAILABLE — DISCOVERY BUDGET EXCEEDED`. Its absence is the
  only other state and means the registry was enumerated within budget.
- **Action.** None — disclosure only.
- **Copy rules.** A truncated list must always say so. It must not be silently capped, and
  it must not be described as an error in the user's own setup. Note that this region
  renders its own truncation copy rather than the shared `TruncationNotice` component; the
  divergence is recorded in `chrome.md` (`UI-CHROME-TRUNCATION-NOTICE`) and should be
  resolved toward one shared disclosure, not by deleting either message.
- **Data authority.** `projection`-adjacent in spirit but `on-chain` in mechanism: the
  budget is exceeded while enumerating on-chain registry reads. Either way it reports the
  **completeness of the read**, never a fact about a market, and must never gate an action.

---

## Region copy rules

1. **Both lenses, always.** Any rate shown here appears as APR and as upfront percentage.
   Showing one alone forces the user to convert, and the conversion is market-specific.
2. **Aggregate only.** No account-scoped figure belongs in a table row; personal data loads
   on request (`positions.md`).
3. **Five states, five representations.** Loading, stale, unavailable, failed, and empty
   never share a rendering (`../SCHEMAS.md` §1).
4. **No risk, health, or liquidation column.** OVRFLO markets have no such state. A comp
   that adds a "health" or "risk" column is showing generative noise and it does not ship
   (`../README.md`; `PRODUCT.md` — *Positioning*).
5. **No fiat.** Amounts stay in the asset's own units.
