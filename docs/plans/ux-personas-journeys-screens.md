# OVRFLO v1 UX Spec — Personas, Journeys, Screens

Status: agreed 2026-07-25. This is the source of truth for the v1 UI/UX pass.
Priority order for every design decision: **Functionality > Simplicity > Busyness**.

## Locked decisions

1. **Instant-only matching.** No resting borrower orders, no matchmaker backend. The
   frontend is a client-side router: it quotes against live liquidity positions and the
   borrower signs one `createBorrowerLoanPool` tx. If liquidity is insufficient at an
   acceptable tick, the UI says so and shows the nearest tick that works.
2. **Borrow-only v1.** Selling streams (instant sale and sale listings) is out of scope.
   Stream cards have exactly two verbs: **Claim** and **Borrow**. The borrow quote panel
   is designed so a Sell tab can slot in later (same price math, no residual line).
3. **Lifecycle-complete vault scope.** In v1: deposit PT, claim from stream, claim PT
   after maturity (burn ovrfloTokens), unwrap to underlying (when wrap reserve allows).
   Wrap (underlying → ovrfloToken) is hidden behind an "advanced" affordance.
4. **Single page: summary strip + markets table.** No separate portfolio page. A compact
   aggregate strip sits above the markets table; positions are managed inside each
   market's expandable row. Matches the existing `MarketsApp` architecture.

## Grounding in the contracts (verified)

- APR is discrete: `aprBps` must be a multiple of `APR_STEP_BPS` within
  `[aprMinBps, aprMaxBps]` (`OVRFLOLending._validateApr`). The market UI is therefore an
  **order-book-style ladder of ticks**, not a curve or slider.
- `gatherLiquidity(market, aprBps, targetAmount, startId, borrower)` is the onchain FIFO
  scanner and already excludes self-match. It is the router's fallback primitive.
- A loan pool consumes positions at **one tick only** (`_validateLiquidity` requires
  matching `aprBps`). Matching = pick a tick, fill within it. No cross-tick pools.
- Markets fix underlying, fee, and expiry, so **APR ↔ upfront-%** is a deterministic
  per-market conversion. Every rate is always shown in both lenses:
  lender lens "8% fixed APR" ≡ borrower lens "receive ~92% upfront" (at that expiry).
- Loans are self-repaying: the stream pays down the obligation; the residual stream
  returns to the borrower. No margin calls, no liquidations — say this in the UI.

## Personas & user stories

### P1 — Depositor (has PT, wants amplified fixed yield)
- Select a market, deposit PT, receive ovrfloTokens + a Sablier stream — capturing the
  PT discount as a claimable stream.
- Watch the stream fill in real time; **claim whenever** — the no-frills default journey
  is deposit → watch → claim.
- See at a glance what the stream could fetch upfront (borrow teaser) without committing.
- After maturity, burn ovrfloTokens to claim PT; before maturity, unwrap to underlying
  when the wrap reserve allows.

### P2 — Borrower (has stream, needs upfront capital)
- See liquidity per tick as **"you receive X% upfront"** — choose by outcome.
- Pledge the stream, receive underlying now, in one transaction.
- Never assemble liquidity IDs manually — the router pools FIFO automatically.
- Watch the loan self-repay; get the residual stream back when the obligation is met.
- A returned stream can be re-pledged to a new loan.

### P3 — Lender (has underlying, wants fixed return)
- Supply at a chosen tick; see the return as **"you earn +X% over Y days"**.
- See demand per tick (trailing 30d borrow volume + current utilization from the Ponder
  indexer) to price competitively. Demand is historical — there is no forward book.
- See position state: unconsumed (withdrawable anytime), consumed into loans, and
  claimable proceeds (`claimLoanPoolShare`).
- Reprice by withdraw + re-supply (batched via Multicall as one "Adjust rate" action).

## Empathy map

| | Depositor | Borrower | Lender |
|---|---|---|---|
| **Thinks** | "Is my yield actually locked in?" | "How much do I give up for cash now?" | "Will my liquidity get used?" |
| **Feels** | Wants set-and-forget safety | Urgency; hates opaque haircuts | Impatience while idle; fear of mispricing |
| **Sees** | Stream filling, claimable balance | Upfront-% ladder, one big number | Demand per tick, utilization, proceeds |
| **Does** | Deposits once, claims occasionally | Compares ticks, pledges, forgets | Adjusts rate, monitors fills, claims share |

Design counters: borrower fill anxiety → live ladder + one-number quote; lender idle
capital → demand column; APR/upfront confusion → always both lenses; depositor trust →
progress bar + "self-repaying, residual returns to you" copy on loans.

## Journey maps

### Depositor
```
AWARE            ACT               LIVE                 EXIT
"PT discount  →  Pick market,   →  Stream fills;     →  Post-expiry: burn ovrfloTokens
is yield I       deposit PT        claim any time       for PT. Anytime: unwrap to
can stream"      (1 approval       [Claim] whenever     underlying (reserve-bounded).
                 + 1 tx)           it's worth gas
curiosity        commitment        calm ✓               completion ✓
```

### Borrower
```
AWARE          DECIDE             ACT                LIVE                EXIT
"I have a   →  Ladder: 92% /  →  One tx: pledge  →  Loan card:       →  Obligation met;
stream, I      90% / 88%         stream, get       obligation          residual stream
need cash"     upfront           $7,387 now        remaining bar       returns; can
                                                   (self-repaying)     re-pledge
curiosity      calculating       commitment        reassurance         delight ✓
```
Failure branch at ACT: liquidity moved between quote and tx → tx reverts → UI re-quotes
at next viable tick ("Liquidity changed — new quote: $7,301 at 9%"). One state, not a
lifecycle.

### Lender
```
AWARE           ACT              WAIT                LIVE                 EXIT
"Fixed X%   →   Supply $N    →   Unconsumed;     →   Consumed into    →   Claim share;
over Y%          at tick         demand column       loans; proceeds      withdraw
maturity"                        informs whether     accrue pro-rata      unconsumed
                                 to reprice                               anytime
appraisal       commitment       impatience ⚠        satisfaction         completion ✓
```
The WAIT emotion is the lender's risk moment — mitigate with the demand column and a
frictionless one-tx "Adjust rate".

## Client-side router spec (borrower quote → tx)

Given market `M`, stream `S`, requested amount `A` (default: max borrowable):

1. Build the ladder: for each tick from `aprMinBps` upward, sum available liquidity
   (excluding the borrower's own positions — self-match is skipped).
2. Pick the **lowest tick** whose total available ≥ `A`'s required contribution.
3. Within the tick, prefer the **first single position that alone covers** (FIFO by ID);
   otherwise FIFO-accumulate positions (per `gatherLiquidity` semantics) until covered.
   Single-coverage-first minimizes positions consumed and fragmentation.
4. Price cap (added 2026-07-25 after plan review): a tick's `grossPrice` shrinks as APR
   rises, so a tick can cover `A` in liquidity while capping the borrow below it in
   price. Every candidate tick's quote clamps the amount to `min(A, grossPrice at that
   tick)`; a clamped offer is presented as partial even when liquidity alone covers.
5. If no tick covers `A`: offer both (a) reduce `A` to the best tick's capacity, and
   (b) the cheapest covering tick, clamped per rule 4. Show both as concrete quotes,
   labeled by outcome ("most cash now" vs "lowest rate") rather than ranked.
6. On tx revert from a liquidity race: re-run 1–5, present the delta, re-confirm.

No backend. Ladder data from contract views + Ponder for trailing demand/volume.

## Screen inventory

### S0 — Landing (connected)
```
┌──────────────────────────────────────────────────────────────┐
│ OVRFLO                                     [0x1a…f3] [⛓]     │
├──────────────────────────────────────────────────────────────┤
│ MY POSITIONS ──────────────────────────────────────────────  │
│  Streams: 2 ($14,200 flowing)   Supplied: $50k @ 8%          │
│  Loans: 1 (self-repaying, 64% repaid)   Claimable: $1,830    │
│                                              [Claim all ↓]   │
├──────────────────────────────────────────────────────────────┤
│ MARKETS                                                      │
│  Market            Expiry    TVL     Supply APR   Borrow ↑%  │
│ ▸ wstETH  DEC-26   152d     $2.1M    6–10%       90–94%      │
│ ▾ wstETH  JUN-27   334d     $840k    7–12%       84–91%      │
│   ┌─ MY POSITIONS IN THIS MARKET ─────────────────────────┐  │
│   │ Stream #4412   $8,100 flowing      [Claim] [Borrow]   │  │
│   │ ovrfloToken    3.2 oWSTETH         [Unwrap]           │  │
│   │ Supply $50k @ 8% ($12k consumed)   [Adjust][Withdraw] │  │
│   └───────────────────────────────────────────────────────┘  │
│   [ SUPPLY ]  [ BORROW ]  [ DEPOSIT PT ]                     │
└──────────────────────────────────────────────────────────────┘
```
- Strip rows are aggregates across markets and informational-only; CLAIM ALL is the
  strip's single action (per-cell navigation dropped 2026-07-25 — with aggregates
  spanning markets there is no honest click target).
- Disconnected state: markets table only, strip replaced by connect CTA.
- Market row expansion = position management for that market + the three mode buttons.
- Market selection fixes underlying/fee/expiry — downstream forms never re-ask.
- ovfloToken row is context-aware: pre-expiry [Unwrap] (disabled with reason when the
  wrap reserve can't cover), post-expiry [Claim PT]. Advanced toggle reveals [Wrap].

### S1 — BORROW mode (inside a market)
```
┌─ wstETH JUN-27 · BORROW ─────────────────────────────────────┐
│  Your stream: #4412 — $8,100 remaining, 334d               ▼ │
│                                                              │
│  YOU RECEIVE UPFRONT        RATE      LIQUIDITY AVAILABLE    │
│  ██████████████ 91.2%       8%        $46,000  ← best        │
│  ████████████   90.1%       9%        $120,000               │
│  ██████████     89.0%       10%       $61,500                │
│                                                              │
│  ┌────────────────────────────────────────────┐              │
│  │ Borrow against #4412 at 8%                 │              │
│  │ You receive NOW:      $7,387  (91.2%)      │              │
│  │ Stream repays:        $8,100 over 334d     │              │
│  │ Residual returns to you when obligation met│              │
│  │              [ Get $7,387 now ]            │              │
│  └────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```
- Default selection: best (lowest) tick that covers. Ticks are tappable to compare.
- Insufficient-liquidity state: ladder rows gray out; panel shows the two router
  fallback quotes (reduced amount at best tick vs full amount at deeper tick).
- Race/revert state: inline re-quote banner with delta, single re-confirm button.

### S2 — SUPPLY mode
```
┌─ wstETH JUN-27 · SUPPLY ─────────────────────────────────────┐
│  RATE    YOU EARN (334d)    LIQUIDITY WAITING   DEMAND*      │
│  8%      +7.3% fixed        $46,000             ███ high     │
│  9%      +8.2% fixed        $120,000            ██  med      │
│  10%     +9.1% fixed        $61,500             ▍   low      │
│  *borrow volume at this tick, trailing 30d (indexer)         │
│                                                              │
│  Supply [ $25,000 ] at [ 8% ▾ ]                              │
│  → Earns 8% APR as streams are borrowed against it           │
│  → Withdraw unconsumed liquidity anytime                     │
│                     [ Supply ]                               │
└──────────────────────────────────────────────────────────────┘
```

### S3 — DEPOSIT PT mode
```
┌─ wstETH JUN-27 · DEPOSIT ────────────────────────────────────┐
│  Deposit [ 10.0 PT-wstETH ]        Balance: 12.4             │
│                                                              │
│  You receive:                                                │
│   • 10.0 oWSTETH (1:1, tradable/unwrappable)                 │
│   • Stream: ~0.62 wstETH over 334d (the PT discount,         │
│     net of fee) — claim as it flows                          │
│                                                              │
│  Fee: 0.4% of market value   Deposit cap: none               │
│                  [ Approve ] [ Deposit ]                     │
└──────────────────────────────────────────────────────────────┘
```

### S4 — Stream card / claim (the deliberately boring default journey)
```
┌─ Stream #4412 · wstETH JUN-27 ───────────────────────────────┐
│   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  46% streamed                       │
│   Claimable now:  1.24 wstETH        [ Claim ]               │
│   Remaining:      4.71 wstETH · ends JUN-27                  │
│   ⚡ Need it sooner? → [Borrow ~91% upfront]                 │
└──────────────────────────────────────────────────────────────┘
```
The borrow teaser number is live (best-tick quote) — it is the discovery path from P1
to P2.

### S5 — Loan card (borrower, post-borrow)
```
┌─ Loan #17 · backed by stream #4412 ──────────────────────────┐
│   Received upfront: $7,387 (91.2% @ 8%)                      │
│   Obligation: ▓▓▓▓▓▓▓▓░░░░  $5,190 of $8,100 repaid          │
│   Self-repaying from the stream — nothing to do.             │
│   When repaid: residual stream returns to you.               │
└──────────────────────────────────────────────────────────────┘
```
No verbs in the happy path. (`repayLoan` early-repay can live behind an advanced
affordance; `closeLoan` is permissionless housekeeping, not a user journey.)

### S6 — Lender position card
```
┌─ Supply #9 · wstETH JUN-27 @ 8% ─────────────────────────────┐
│   Supplied: $50,000    Consumed into loans: $12,000          │
│   Idle: $38,000 [Withdraw]    Claimable: $310 [Claim]        │
│   Demand at 8%: ███ high — 6 loans, $84k, 30d                │
│                                    [Adjust rate ▾]           │
└──────────────────────────────────────────────────────────────┘
```
"Adjust rate" = Multicall(withdraw idle, re-supply at new tick), one signature.

## Edge & empty states (design these, don't discover them)

- **Empty ladder** (no liquidity in market): borrow mode shows lender lens teaser
  ("Be the first lender — demand exists: N streams, $X, 30d").
- **Liquidity race**: revert → re-quote banner (S1 note). Never a dead-end error.
- **Post-maturity market**: borrow/supply disabled with reason (`marketActive` gate);
  claim paths remain; ovfloToken row switches to [Claim PT].
- **Deposit cap reached**: deposit form disabled with the cap shown (0 = unlimited).
- **Self-match**: lender viewing borrow mode sees own positions excluded from the
  ladder totals, with a footnote ("excludes your $50k supply").
- **Wrap reserve short**: [Unwrap] disabled with amount currently unwrappable.
- **Stream fully drawn by loan** (obligation not yet met at expiry boundary): loan card
  copy explains `_claimFair` deficit harvesting — lender-side, not borrower-facing.

## Deferred (explicitly out of v1)

- Selling streams: instant sale + sale listings and all listing management.
- Resting borrower orders / matchmaker backend / notifications.
- Wrap as a first-class flow (advanced-only in v1).
- Separate portfolio page.

## Open assumptions (flag if wrong)

1. Outcome-first language everywhere; raw bps/contract terms only in tooltips.
2. Amounts displayed in underlying terms (wstETH) with a USD subscript, not the reverse.
3. Desktop-first layout; ladder collapses to a picker on mobile — no separate mobile IA.
4. "Claim all" on the strip batches stream claims + `claimLoanPoolShare` via Multicall.
