# Region brief — Watch surface

**Slug:** `WATCH` · **Control ID prefix:** `UI-WATCH-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/app/page.tsx` (R12 entry gate). U7 lands
`web/components/watch/{Wall,SuppliedDetail,BorrowedDetail,StreamDetail,ClosedLoanDetail}.tsx`.

**Purpose of the region.** Home for a connected wallet that holds any protocol object:
the wallet's entities rendered through a role lens as a wall of instruments, each
opening its detail in place. Lenders watch earnings roll up with claim at hand;
borrowers watch debt roll down to a known done-date; resting capital stays honestly
inert. Actions live on the entities that own them. There is no aggregate attention
strip.

**Boundary.** Disconnected entry is `UI-SHELL-ENTRY-DISCONNECTED`. Guided first run is
`first-run.md` and renders only when positions, loans, *and* stream discovery are all
confirmed empty. Write checkpoints, SETTLEMENT trace, and receipts are `review.md`.
Borrow / Supply / Assets flows launch from this region and from `UI-SHELL-NAV`.

**Entry (R12).** After `UI-SHELL-ENTRY-SYNCING`: any position, loan, or hydrated stream
→ this region. Confirmed empty of all three → `first-run.md`. Stream discovery pending
or could-not-ask while on-chain books read zero → this region with
`UI-WATCH-STREAMS-DEGRADED` (never first-run).

---

## `UI-WATCH-LENS`

- **ID.** `UI-WATCH-LENS`
- **Purpose.** Show one role's entities at a time: Supplied, Borrowed, or Streams.
- **Visible when.** The watch surface is showing. A lens whose **confirmed** count is
  zero is **hidden**, not rendered empty. A pending or failed book read is not a
  confirmed zero: that lens stays visible in loading or unavailable so a could-not-ask
  cannot masquerade as "you have none". When stream discovery is degraded, the Streams
  lens remains visible so the failure has a place to live.
- **States.**
  - `supplied` / `borrowed` / `streams` — the active lens.
  - `loading` / `unavailable` — the lens stays mounted while its book or discovery
    read is in flight or failed; it is not hidden and not shown as zero-count.
  - APG tablist: roving tabindex, arrow keys, Home/End, automatic activation.
- **Action.** Switching lens updates the URL `?lens=` and writes per-wallet
  `localStorage`. Resolution order: URL param → per-wallet memory → supplied default
  (dual-role wallets; lenders visit most, on claim cadence). An invalid URL value is
  ignored and the next fallback applies. Memory is keyed by lowercased address; a
  different account never inherits the previous account's lens.
- **Copy rules.** Labels: `SUPPLIED`, `BORROWED`, `STREAMS`. No counts on the tabs
  that could be mistaken for actionable badges. No `ALL` mixed book. No `NOW`/`NEXT`
  strip beside the tabs.
- **Data authority.** `pure-client` for which lens is selected and for memory.
  `on-chain` for the counts that hide a **confirmed-zero** lens (position and loan
  enumeration). A failed enumeration does not hide the lens. `projection` for the
  stream-candidate count that hides Streams — and a could-not-ask must not hide
  Streams (that is `UI-WATCH-STREAMS-DEGRADED`).

## `UI-WATCH-WALL`

- **ID.** `UI-WATCH-WALL`
- **Purpose.** Give a two-second scan of the active lens: one row per entity.
- **Visible when.** Watch is showing and the active lens is not in a full-region
  unavailable state.
- **States.**
  - `loading` — bounded placeholders; never zero rows that read as "you hold nothing".
  - `ready` — one row per entity.
  - `empty` — must not occur for a visible lens: zero-count lenses are hidden. If it
    would occur, the entry gate misclassified; do not render an empty meter wall
    (AE5).
- **Action.** None itself — rows are `UI-WATCH-ROW-*`.
- **Copy rules.** No demonstration loan, no synthetic instrument, no spectator row.
- **Data authority.** `on-chain` for positions and loans.
  `projection` for stream candidates, each hydrated `on-chain` before a row renders.

## `UI-WATCH-ROW-SUPPLIED`

- **ID.** `UI-WATCH-ROW-SUPPLIED`
- **Purpose.** Identify one lender position, lead with match state, and show the
  role's decisive number.
- **Visible when.** The Supplied lens is active and this position exists for the
  connected account.
- **States.**
  - `resting` — filled is zero. No motion of any kind. State line says nothing
    accrues until matched. Decisive number is unfilled capital.
  - `partial` — filled x of y. State line leads with the fill (including a fill that
    happened between visits — AE3). Decisive number is claimable earnings when
    nonzero, otherwise filled/unfilled.
  - `filled` — unfilled is zero. Decisive number is claimable earnings.
  - `loading` / `unavailable` — the position id is known but `positionState` has not
    resolved or failed; never render as resting-with-zero.
- **Action.** Activates `UI-WATCH-SELECT` for this `position` id.
- **Copy rules.** Match state before yield figures (R11). Resting copy must not
  animate, pulse, or tick. Token symbol from the market's live `symbol()` — never a
  hardcoded `ovrfloWSTETH`. No health factor, no utilisation bar coloured as risk.
- **Data authority.** `on-chain` — `positionState` (supplied, filled, unfilled,
  claimable, tick). Schedule interpolation of claimable accrual is derived from
  on-chain fill time plus the shared clock; it never invents motion on a resting
  row.

## `UI-WATCH-ROW-BORROWED`

- **ID.** `UI-WATCH-ROW-BORROWED`
- **Purpose.** Identify one loan and answer "when is this over?" at a glance.
- **Visible when.** The Borrowed lens is active and this loan exists for the
  connected account. Closed loans render as `UI-WATCH-ROW-SETTLED`, ordered after
  active loans.
- **States.**
  - `repaying` — outstanding nonzero and not yet close-ready. Decisive number is
    outstanding, counting down. State line includes approximate done-date.
  - `close-ready` — withdrawable stream value covers outstanding (R9, AE4). State
    line yields to close; ribbon stops projecting further accrual toward the
    obligation.
  - `loading` / `unavailable` — never as outstanding-zero.
- **Action.** Activates `UI-WATCH-SELECT` for this `loan` id.
- **Copy rules.** Done-date is approximate (`~08 JAN 2027`) because repayments and
  claims shift it. Never a health factor, liquidation price, or "at risk" caption.
  The loan is self-repaying; the stream is the schedule.
- **Data authority.** `on-chain` — `loanState` (obligation, drawn, repaid,
  outstanding, stream id, tick) and Sablier `withdrawableAmountOf` for close-ready.
  Cover date is derived (`payoff.ts`) from on-chain schedule + outstanding; `~` day
  precision. Hero countdown interpolates from those on-chain inputs plus the clock.

## `UI-WATCH-ROW-STREAM`

- **ID.** `UI-WATCH-ROW-STREAM`
- **Purpose.** Identify one vault-created stream as vesting collateral inventory.
- **Visible when.** The Streams lens is active. **Only vault-created streams render:**
  `getStream.sender` is a registered OVRFLO vault **and** `getStream.asset` is that
  market's ovrflo token (R4 eligibility mirror of `requireEligible` in
  `src/StreamPricing.sol`). Other Sablier NFTs the wallet holds do not appear.
  Pledged streams still appear, linking to their loan.
- **States.**
  - `eligible` — unpledged and remaining face value nonzero; route into Borrow is
    offered.
  - `pledged` — linked to its loan; no transfer action, no second borrow.
  - `vesting` — unpledged; decisive number is vested / remaining.
  - `loading` / dropped — a candidate that fails `ownerOf` or the eligibility
    mirror is not rendered (dropped, not shown as empty).
- **Action.** Activates `UI-WATCH-SELECT` for this `stream` id.
- **Copy rules.** Amounts in the market's ovrflo token from live `symbol()`. Never
  describe the stream as collateral at risk of liquidation. Never list a stream the
  eligibility mirror would reject.
- **Data authority.** `projection` for the candidate set (bounded logs). `on-chain`
  for `ownerOf`, `getStream` (sender, asset, schedule, remaining), and pledged
  status via loan reads. A candidate is never shown on projection alone. Eligibility
  that later gates Borrow is re-read from chain at that gate.

## `UI-WATCH-ROW-SETTLED`

- **ID.** `UI-WATCH-ROW-SETTLED`
- **Purpose.** Keep a closed or fully repaid loan readable on Borrowed, identifying
  the returned stream.
- **Visible when.** Borrowed lens is active and the loan is closed or outstanding is
  zero after full repay. Ordered after active loans. On the same reconciling read,
  the freed stream reappears under Streams as eligible (R9).
- **States.** One: `settled`. No actions. Not dimmed into invisibility — identity and
  returned stream remain readable.
- **Action.** Activates `UI-WATCH-SELECT` for this `loan` id (detail is
  `UI-WATCH-DETAIL-SETTLED`).
- **Copy rules.** Badge `SETTLED`. Name the returned stream id. Never "liquidated",
  never "written off".
- **Data authority.** `on-chain` — loan closed flag / outstanding zero, and the
  stream id recorded on the loan.

## `UI-WATCH-SELECT`

- **ID.** `UI-WATCH-SELECT`
- **Purpose.** Select or deselect a wall row and reflect that in the URL so deep
  links and Back work at every width.
- **Visible when.** Watch is showing.
- **States.** `none` (wall only), `position`, `loan`, `stream` — exactly one entity
  kind at a time.
- **Action.** Selecting writes `?lens=` plus `?position=` or `?loan=` or `?stream=`
  and opens the matching detail. Deselecting clears the entity param and keeps
  `?lens=`. Deep links select and scroll the row into view. Wide viewports open
  detail in place; narrow viewports use `UI-WATCH-NARROW-NAV`.
- **Copy rules.** None beyond the row's own copy. Do not add a "selected" badge that
  implies urgency.
- **Data authority.** `pure-client` — URL and selection. The entity's facts remain
  `on-chain` as documented on the row and detail.

## `UI-WATCH-NARROW-NAV`

- **ID.** `UI-WATCH-NARROW-NAV`
- **Purpose.** Below 1024px, treat the wall as a list screen and the detail as its
  own screen with a return affordance (KTD13).
- **Visible when.** Viewport width is below 1024px and an entity is selected.
- **States.** `list` (no entity param), `detail` (entity param set).
- **Action.** `←` clears the entity param (deselect) and returns to the wall. Browser
  Back does the same. URL still carries `?lens=` and the entity param at every
  width, so a deep link opened on a phone lands on detail.
- **Copy rules.** Return control accessible name `Back to <lens>`. Not `Close`, not
  `Cancel` — nothing is being aborted.
- **Data authority.** `pure-client` — viewport and URL.

## `UI-WATCH-DETAIL-SUPPLIED`

- **ID.** `UI-WATCH-DETAIL-SUPPLIED`
- **Purpose.** Watch one lender position: earnings hero, then actions, then ribbons
  and facts, then freshness.
- **Visible when.** A supplied position is selected.
- **States.** Same match states as `UI-WATCH-ROW-SUPPLIED`, plus `stale` when event
  reads are degraded (heroes keep ticking; signing disabled).
- **Action.** None itself. Children: `UI-WATCH-HERO-EARNINGS`, `UI-WATCH-CLAIM`,
  `UI-WATCH-WITHDRAW`, `UI-WATCH-RIBBON`, `UI-WATCH-CAPITAL-BAND`,
  `UI-WATCH-FRESHNESS`. Hierarchy: hero → action → ribbons → facts → freshness
  caption.
- **Copy rules.** Facts name supplied, filled, unfilled, claimable, APR tick, market
  maturity, amount currently ahead. Token symbols from live `symbol()`.
- **Data authority.** `on-chain` for `positionState` and `loansOf` (which loans
  contribute to claim). Ahead-in-queue is `on-chain` from the tick tree / depths.

## `UI-WATCH-DETAIL-BORROWED`

- **ID.** `UI-WATCH-DETAIL-BORROWED`
- **Purpose.** Watch one loan: outstanding hero counting down, then repay/close,
  then the debt ribbon to the done-date.
- **Visible when.** An active loan is selected.
- **States.** `repaying`, `close-ready`, `stale` — same rules as the row. A repay
  amount preview (inside the repay flow, `UI-REVIEW-REPAY`) shows the done-date
  moving before signing (AE6); this detail itself does not take a repay amount.
- **Action.** None itself. Children: `UI-WATCH-HERO-OUTSTANDING`, `UI-WATCH-REPAY`,
  `UI-WATCH-CLOSE`, `UI-WATCH-RIBBON`, `UI-WATCH-FRESHNESS`. Same hierarchy as
  supplied.
- **Copy rules.** Show actual net proceeds, obligation, recovered, outstanding, APR,
  pledged stream, maturity, approximate done-date, live countdown. Never a
  liquidation gauge.
- **Data authority.** `on-chain` for `loanState` and stream withdrawable. Cover date
  derived from on-chain inputs.

## `UI-WATCH-DETAIL-STREAM`

- **ID.** `UI-WATCH-DETAIL-STREAM`
- **Purpose.** Show one vault-created stream's schedule and its route into Borrow,
  or its link to the pledged loan.
- **Visible when.** A stream is selected that passed the eligibility mirror.
- **States.** `eligible`, `pledged`, `stale` (schedule interpolation continues;
  event facts as-of).
- **Action.** None itself. Children: `UI-WATCH-HERO-VESTED`,
  `UI-WATCH-BORROW-ROUTE` (eligible only), `UI-WATCH-RIBBON`, `UI-WATCH-FRESHNESS`.
  Pledged state links to the loan via `UI-WATCH-SELECT` (`?loan=`).
- **Copy rules.** Source series, released, remaining, maturity, transferability,
  pledged or not. No Sablier `withdrawMax` control on this surface — v1 watch
  treats streams as collateral inventory (R4); lender harvest is `UI-WATCH-CLAIM`.
- **Data authority.** `on-chain` for `getStream` / `withdrawableAmountOf` / owner.
  `projection` only as the candidate that led here.

## `UI-WATCH-DETAIL-SETTLED`

- **ID.** `UI-WATCH-DETAIL-SETTLED`
- **Purpose.** Read a closed loan and the stream it returned.
- **Visible when.** A settled loan is selected.
- **States.** One: `settled`. No repay, no close.
- **Action.** A control naming the returned stream selects it (`?stream=`).
- **Copy rules.** `SETTLED`. Identify the returned stream. Do not offer Borrow here
  — Borrow lives on the stream once it reappears under Streams.
- **Data authority.** `on-chain`.

## `UI-WATCH-HERO-EARNINGS`

- **ID.** `UI-WATCH-HERO-EARNINGS`
- **Purpose.** Make earnings visible as a large gold number growing per second, with
  CLAIM adjacent when claimable is nonzero.
- **Visible when.** Supplied detail is open and the position has any filled capital.
  Absent on a resting (zero-filled) position — showing a ticking zero would be a
  lie (R5, AE2).
- **States.**
  - `ticking` — `role="timer"` (implicit `aria-live="off"`: silent per tick,
    queryable on demand). `tabular-nums` in a fixed-width container.
  - `inert` — filled became zero after a full withdraw of remainder; unmounts.
  - `reduced-motion` — decorative canvas motion stops; the numeric text keeps
    updating at 1 Hz.
- **Action.** None. `UI-WATCH-CLAIM` sits beside it.
- **Copy rules.** Gold accent on this number only as the dominant moving value.
  Token symbol from live `symbol()`. Never a USD-only hero; USD may sit dim beside
  it when `UI-SHELL-TOKEN-USD` is `usd` and the feed is fresh.
- **Data authority.** Display is derived from `on-chain` schedule/fill parameters
  plus a `pure-client` shared 1 Hz clock. Event-derived harvested claimable changes
  only on chain reads. Interpolation never feeds a gate. Interpolation clamps to
  the stream/fill formula; a fast local clock never displays more than the on-chain
  answer would. Accumulating per-tick deltas is banned.

## `UI-WATCH-HERO-OUTSTANDING`

- **ID.** `UI-WATCH-HERO-OUTSTANDING`
- **Purpose.** Make the outstanding visible as a large number counting down
  (−rate/day, done-date, live countdown).
- **Visible when.** Borrowed detail is open for an active loan.
- **States.** `ticking` (`role="timer"`), `close-ready` (countdown has handed off to
  event truth; outstanding still shown), `reduced-motion` as above. Countdown
  clamps at zero and never goes negative.
- **Action.** None.
- **Copy rules.** Approximate done-date with `~`. Rate/day named in the market's
  ovrflo token. Never "liquidation in …".
- **Data authority.** Display is derived from `on-chain` obligation/outstanding/
  schedule plus a `pure-client` clock, with skew offset from `block.timestamp`.
  Event outstanding updates only on reads. Interpolation never feeds a gate.

## `UI-WATCH-HERO-VESTED`

- **ID.** `UI-WATCH-HERO-VESTED`
- **Purpose.** Show vested stream value moving per second.
- **Visible when.** Stream detail is open.
- **States.** `ticking` (`role="timer"`), `reduced-motion`.
- **Action.** None.
- **Copy rules.** Vested vs remaining in the market's ovrflo token. Not a claim
  button.
- **Data authority.** Display is derived from `on-chain` `getStream`
  start/end/deposited plus a `pure-client` clock, clamped to Sablier's formula and
  end time. Interpolation never feeds a gate.

## `UI-WATCH-RIBBON`

- **ID.** `UI-WATCH-RIBBON`
- **Purpose.** Draw every moving value in one idiom: recorded time, not spectacle.
- **Visible when.** On every wall miniband and every detail ribbon (earnings, debt,
  vesting). Wall minibands are CSS dot patterns; detail ribbons are canvas (U4).
- **States.** Five, and they must stay distinguishable:
  - `recorded` — dense dots for what has already happened.
  - `edge` — gold marker at now.
  - `future` — faint dots for the scheduled remainder, ending at the entity's
    terminal date.
  - `inert` — resting supply: the band is drawn as a static unfilled span with
    **zero motion** (no edge crawl, no shimmer, no ticking dots).
  - `degraded` — event reads stale; recorded/edge/future keep interpolating from
    the last known schedule while `UI-WATCH-FRESHNESS` marks events as-of. The
    ribbon does not freeze and does not invent fills, claims, or closes.
- **Action.** None. `role="meter"` with `aria-valuetext` on repayment and capital
  bands; the ribbon beside a `role="timer"` hero does not also live-announce.
- **Copy rules.** Terminal date is labelled. No glow, no feed, no number-go-up
  particle. Gold marks the edge and nothing else on the band.
- **Data authority.** Schedule geometry is derived from `on-chain` start/end plus
  the clock. Event marks (fills, claims, repays, close) are `on-chain` and move
  only on reads. `projection` never draws a ribbon.

## `UI-WATCH-CAPITAL-BAND`

- **ID.** `UI-WATCH-CAPITAL-BAND`
- **Purpose.** Show filled vs unfilled capital as hard-ruled segments; a new fill
  begins an earnings-accrual segment (R10).
- **Visible when.** Supplied detail is open.
- **States.** `resting` (single unfilled span, inert), `segmented` (one hard rule
  per fill), `degraded` (last-known segments; no invented fill).
- **Action.** None. Unfilled is marked withdrawable when `UI-WATCH-WITHDRAW` is
  visible. `role="meter"` + `aria-valuetext`.
- **Copy rules.** Segments are fills, not risk tranches. Never colour a segment as
  health or utilisation.
- **Data authority.** `on-chain` — `positionState` and `loansOf` fill intervals.

## `UI-WATCH-CLAIM`

- **ID.** `UI-WATCH-CLAIM`
- **Purpose.** Collect this position's claimable recovered value, with the live
  amount in the control.
- **Visible when.** Supplied detail (and the wall row, as a compact control) when
  claimable is nonzero. **Removed**, not disabled, when claimable is zero. No
  cross-position Claim-All exists.
- **States.** `enabled` (amount in the label), `disabled-stale` (degraded/stale
  reads; signing blocked), `absent` (claimable zero).
- **Action.** Launches the claim checkpoint grammar in place
  (`READY → WALLET_SIGNATURE → PENDING → CONFIRMED` via `UI-REVIEW-CLAIM` /
  `UI-REVIEW-SETTLEMENT-TRACE`). On-chain: `claim` for this position's loans
  (Multicall batch of this position only). Pays recovered value in the market's
  ovrflo token, not underlying.
- **Copy rules.** `CLAIM <amount> <symbol>` with live `symbol()`. Never "CLAIM ALL".
  Never imply underlying arrives; the receipt says ovrflo token
  (`UI-REVIEW-CLAIM-CONFIRMED`).
- **Data authority.** `on-chain` — claimable re-read at the gate from `loansOf` /
  `loanState`. Display interpolation may preview accrual; it does not authorise.

## `UI-WATCH-WITHDRAW`

- **ID.** `UI-WATCH-WITHDRAW`
- **Purpose.** Return unfilled capital to the lender.
- **Visible when.** Supplied detail when unfilled is nonzero. **Removed** when
  unfilled is zero.
- **States.** `enabled`, `disabled-stale`, `absent`.
- **Action.** Launches withdraw review (`UI-REVIEW-WITHDRAW`). On-chain:
  `withdraw` of the exact refundable unfilled amount; owner-only.
- **Copy rules.** `WITHDRAW UNFILLED`. Name the exact amount and token. Never
  describe it as unwinding a loan.
- **Data authority.** `on-chain` — unfilled re-read at the gate.

## `UI-WATCH-REPAY`

- **ID.** `UI-WATCH-REPAY`
- **Purpose.** Let anyone pay ovrflo token against outstanding; the pledged stream
  always returns to the recorded borrower.
- **Visible when.** Borrowed detail while outstanding is nonzero (including
  close-ready — repay remains available until close or full repay).
- **States.** `enabled`, `disabled-stale`, `absent` (settled).
- **Action.** Launches `UI-REVIEW-REPAY` (amount → optional wrap shortfall →
  approve → sign). On-chain: `repay`. Full repay closes the loan; partial keeps it
  active and refreshes outstanding.
- **Copy rules.** `REPAY`. When payer ≠ borrower, state that the released stream
  returns to the recorded borrower. Repay is in the market's ovrflo token.
- **Data authority.** `on-chain` — outstanding re-read at the gate.

## `UI-WATCH-CLOSE`

- **ID.** `UI-WATCH-CLOSE`
- **Purpose.** Draw from the pledged stream to settle outstanding and return the
  residual stream.
- **Visible when.** Borrowed detail when the UI has verified withdrawable stream
  value covers outstanding. Permissionless does not mean always executable —
  **removed** until that check passes. Close-ready is the flip (R9, AE4).
- **States.** `enabled`, `disabled-stale`, `absent`.
- **Action.** Launches `UI-REVIEW-CLOSE`. On-chain: `close`. After confirmation, the
  loan becomes `UI-WATCH-ROW-SETTLED` and the freed stream joins Streams on the
  same reconciling read.
- **Copy rules.** `CLOSE FROM STREAM`. Show derived outstanding and current
  withdrawable before signature. Never "liquidate".
- **Data authority.** `on-chain` — outstanding and `withdrawableAmountOf` re-read
  at the gate. Projection does not decide closability.

## `UI-WATCH-BORROW-ROUTE`

- **ID.** `UI-WATCH-BORROW-ROUTE`
- **Purpose.** Route an unpledged eligible stream into Borrow with stream context
  preserved.
- **Visible when.** Stream detail (and compactly on an eligible wall row) when the
  stream is unpledged and still passes remaining-face checks. Absent when pledged.
- **States.** `enabled`, `disabled-stale`, `absent`.
- **Action.** Navigates to `BORROW.ENTER_AMOUNT` with this stream selected
  (`borrow.md`). Full `requireEligible` is re-read at the borrow gate, not here.
- **Copy rules.** `BORROW AGAINST THIS STREAM`. Not a quote. Not "sell" unless the
  later review hits sale equivalence (`UI-BORROW-SALE-EQUIVALENCE`).
- **Data authority.** `on-chain` for pledged/remaining display. The borrow gate
  re-reads eligibility.

## `UI-WATCH-FRESHNESS`

- **ID.** `UI-WATCH-FRESHNESS`
- **Purpose.** Caption the open detail with event freshness so split-truth rendering
  is visible on the instrument itself.
- **Visible when.** Any detail is open.
- **States.** `synced` (`EVENTS AS OF <hh:mm:ss>`), `degraded` (same caption plus
  degraded). Mirrors `UI-SHELL-STATUS` for this entity; does not replace it.
- **Action.** None.
- **Copy rules.** Schedule numbers are not described as "as-of" — they keep moving.
  Only event-derived facts carry the as-of.
- **Data authority.** Same as `UI-SHELL-STATUS`.

## `UI-WATCH-STREAMS-DEGRADED`

- **ID.** `UI-WATCH-STREAMS-DEGRADED`
- **Purpose.** Say stream discovery could not complete, without asserting emptiness
  and without sending the user into first-run.
- **Visible when.** Stream discovery is pending or classifies could-not-ask. When
  on-chain books (positions and loans) are also zero, this state **is** the home
  (R12) — first-run must not render. When books are nonzero, it replaces stream
  rows inside the Streams lens only.
- **States.** `pending` (`CHECKING STREAMS…`), `could-not-ask` (unavailable copy plus
  the direct Sablier recovery route: lockup address and "using your stream id").
  Pending and could-not-ask stay distinct from each other and from empty.
- **Action.** None. Recovery is outside this app (Sablier, stream id). Retry is the
  query layer.
- **Copy rules.** Must state that discovery is unavailable, that streams are
  unaffected, and the direct route. Never "you hold no streams". Never an empty
  wall. Never first-run teaching copy.
- **Data authority.** `projection` — this state *is* the projection reporting its
  own incompleteness. It reports nothing about chain state and must never be read
  as one. Positions and loans continue to render from `on-chain` books.

## `UI-WATCH-MILESTONE`

- **ID.** `UI-WATCH-MILESTONE`
- **Purpose.** Politely announce discrete milestones (fill, covered, confirmed)
  without live-announcing every tick.
- **Visible when.** Always mounted on the watch surface as a single
  `aria-live="polite"` region.
- **States.** `silent` (empty), `announced` (one milestone string, then cleared).
- **Action.** None.
- **Copy rules.** Short, factual: `POSITION FILLED`, `LOAN COVERED`, `CLAIM
  CONFIRMED`. No urgency, no streak, no digest.
- **Data authority.** `on-chain` — milestones fire from reconciled event reads, not
  from interpolation ticks.

---

## Region copy rules

1. **No attention strip.** Actions live on owning entities. Upcoming moments
   (cover date, maturity) render inside their rows and details.
2. **Resting supply is inert.** Zero motion. Animating it is a product defect.
3. **Only vault-created streams under Streams.** Sender is a registered vault and
   asset is that market's ovrflo token. Projection candidates that fail the mirror
   are dropped.
4. **First-run never asserts emptiness discovery cannot confirm.** Degraded
   Streams on zero books is watch, not first-run.
5. **Closed loans stay on Borrowed as SETTLED**; the freed stream reappears under
   Streams on the same reconciling read.
6. **Projection never gates.** Claim, withdraw, repay, and close re-read from
   chain. Interpolation never authorises.
7. **No health factor, liquidation, engagement mechanic, or invented number.**
   Token symbols are market-driven. Heroes are `role="timer"`.
8. **Comps win on pixels; this brief wins on meaning.**
