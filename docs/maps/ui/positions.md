# Region brief — Your positions

**Slug:** `POSITIONS` · **Control ID prefix:** `UI-POSITIONS-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/PositionSummary.tsx` (the `YOUR POSITIONS` strip and
its per-market aggregator) · `web/components/PositionList.tsx` (per-market position cards)

**Purpose of the region.** Answer "what do I currently hold, and what can I act on"
without the user opening anything. Two surfaces share the region because they answer the
same question at two zoom levels: the strip aggregates across markets, the cards
enumerate within one market.

**Boundary.**

- The cards from `PositionList` render **inside** the expanded market row, which
  `settlement.md` owns as a container. The cards' own contracts are documented here; the
  row scaffold that positions them is documented there.
- `CLAIM ALL` is triggered here (`UI-POSITIONS-CLAIM-ALL`) but the queue overlay it opens
  is an action overlay — its controls are `UI-ACTION-CLAIM-ALL-*` in `action.md`.
- The strip shows **no USD and no cross-token total**. Amounts are grouped per token
  symbol and never summed across different tokens.

---

## `UI-POSITIONS-LOAD`

- **ID.** `UI-POSITIONS-LOAD`
- **Purpose.** Let a connected user opt in to a personal-history scan before it runs. The
  scan is expensive and account-scoped, so it is requested, not assumed.
- **Visible when.** A wallet is connected **and** the user has not yet loaded positions for
  that account in this session (`loadedUser !== user`). With no wallet connected the whole
  strip renders nothing — `PositionSummary` returns `null`.
- **States.**
  - `armed` — the button plus its caption. This is the only state; the control unmounts on
    activation and is replaced by the loaded strip.
  - Per-account: the gate is keyed by lowercased address, so switching signers re-arms it.
    A different account must never inherit the previous account's loaded view.
- **Action.** Client-side only: sets `loadedUser`, which mounts the loaded strip and starts
  the per-market liquidity/loan-book reads and the held-stream discovery. No transaction,
  no signature, no approval.
- **Copy rules.** Button: `LOAD POSITIONS`. Caption:
  `PERSONAL HISTORY LOADS ONLY WHEN REQUESTED`. The caption states why the data is absent —
  it must not read as an error, and the absence must never be rendered as "you have no
  positions". Not-yet-asked and empty are different things (`PRODUCT.md` principle 5).
- **Data authority.** `pure-client` — `loadedUser` is browser state. It gates *when* a read
  runs; it never gates whether an action is allowed.

## `UI-POSITIONS-STREAMS`

- **ID.** `UI-POSITIONS-STREAMS`
- **Purpose.** Show how many OVRFLO streams the account holds and how much value remains
  in them, per asset.
- **Visible when.** The strip is loaded (`UI-POSITIONS-LOAD` has fired).
- **States.**
  - `empty` — no discovered streams; renders `—`.
  - `ready` — one line per asset symbol: `<count> · <remaining>`, where remaining is
    `deposited − withdrawn` summed per symbol.
  - The strip cell does **not** carry its own error state; stream-discovery failure surfaces
    in `UI-POSITIONS-STREAMS-UNAVAILABLE` inside the per-market cards, which names the
    recovery route. An agent must not collapse a discovery failure into this cell's `—`:
    `—` here reads as "none", and "none" is a different claim from "could not ask".
- **Action.** None — display only.
- **Copy rules.** Label `STREAMS`. Amounts are token-denominated with their symbol, never
  fiat, never summed across symbols. Do not describe a stream as collateral at risk, and do
  not attach any liquidation or health-factor indicator: OVRFLO streams are non-cancelable
  and deterministic, which is exactly why the product has no liquidation machinery.
- **Data authority.** `on-chain` for each stream's `deposited` / `withdrawn` / `withdrawable`
  (every candidate id is hydrated directly from Sablier at a pinned block, and a
  projection/hydration disagreement fails the whole outcome closed). `projection` for the
  **candidate set and its completeness** — which streams were found at all comes from log
  discovery, so this cell can be complete-looking and still be short. That is why the
  unavailable state exists and must not be flattened.

## `UI-POSITIONS-SUPPLIED`

- **ID.** `UI-POSITIONS-SUPPLIED`
- **Purpose.** Show the lender's idle (unconsumed) liquidity per underlying symbol, and how
  many lending positions it spans.
- **Visible when.** The strip is loaded.
- **States.**
  - `empty` — no reporting markets under any symbol; renders `—`.
  - `ready` — `<count> · <total>` per underlying symbol, where count is liquidity positions
    plus loan pools for that symbol.
  - `unsettled` — at least one market reporting under that symbol is still loading or
    errored; that symbol renders `—` and only that symbol. One market's failure must never
    blank a symbol that is fully ready, and must never be summed as zero.
- **Action.** None — display only. Acting on a position happens on its card
  (`UI-POSITIONS-LIQUIDITY-CARD`).
- **Copy rules.** Label `SUPPLIED`. The figure is **idle** liquidity — liquidity not yet
  consumed by a loan or a sale. Do not label it "earning", "deployed", or "at work"; idle
  liquidity is precisely the part that is not. Never sum across symbols.
- **Data authority.** `on-chain` for each position's amount and rate (direct hydration).
  `projection` for the candidate set. The strip's per-symbol `settled` flag is
  `pure-client` bookkeeping over those outcomes and exists only to keep an unknown from
  rendering as a number.

## `UI-POSITIONS-LOANS`

- **ID.** `UI-POSITIONS-LOANS`
- **Purpose.** Show how many of the account's loans are still repaying, and how far
  repayment has progressed against the total obligation.
- **Visible when.** The strip is loaded.
- **States.**
  - `unsettled` — any contributing market is loading or errored; renders `—`.
  - `empty` — settled with zero open loans; renders `—`.
  - `ready` — `<n> REPAYING · <pct>%`, where pct is `(drawn + repaid) / obligation` summed
    across open loans.
  - `unsettled` and `empty` currently share the `—` glyph. That collapse is a known
    weakness of this cell, not a licence to extend it: any new state added here must be
    distinguishable, and closing this one is a legitimate improvement.
- **Action.** None — display only.
- **Copy rules.** `REPAYING` is the only progress verb. The percentage is repayment
  progress against the obligation — it is **not** a health factor, not a collateral ratio,
  and not a liquidation distance. Never render it as a risk gauge, never colour it as a
  warning band, and never add a threshold marker: a self-repaying loan cannot be
  liquidated, and there is no threshold to mark (`PRODUCT.md` — *Positioning*). A comp that
  shows one is showing generative noise.
- **Data authority.** `on-chain` for `drawn`, `repaid`, `obligation`, and open/closed state.
  `projection` for which loans were discovered.

## `UI-POSITIONS-CLAIMABLE`

- **ID.** `UI-POSITIONS-CLAIMABLE`
- **Purpose.** Show the total the account can claim right now, per asset — pool shares plus
  stream withdrawables.
- **Visible when.** The strip is loaded.
- **States.**
  - `empty` — nothing claimable from either source under any symbol; renders `—`.
  - `ready` — one line per symbol: pool claimable plus stream withdrawable, in that
    symbol's token.
  - `unsettled` — a symbol whose pool side has not settled renders `—` for that symbol,
    even if its stream side is ready. A partial number presented as a total would
    under-report what is claimable.
- **Action.** None — display only. `UI-POSITIONS-CLAIM-ALL` acts on the same set.
- **Copy rules.** Label `CLAIMABLE`. Pool shares pay out in the market's ovrfloToken, not in
  the underlying — the symbol shown must be the token actually received. Never present a
  claimable figure as guaranteed proceeds of a future action; it is the amount claimable at
  the read block and can be consumed elsewhere before the user signs.
- **Data authority.** `on-chain` for pool claimable and stream withdrawable. `projection`
  for the discovered pool/stream sets.

## `UI-POSITIONS-CLAIM-ALL`

- **ID.** `UI-POSITIONS-CLAIM-ALL`
- **Purpose.** Open the batch-claim review overlay for everything currently claimable
  across markets and streams.
- **Visible when.** The strip is loaded. The button is always rendered in that state; it is
  its `disabled` flag, not its presence, that reflects whether anything is claimable.
- **States.**
  - `enabled` — total claimable across pools and streams is greater than zero.
  - `disabled` — total is zero; the caption `NOTHING CLAIMABLE YET` renders beside it.
  - The disabled state is computed from the *ready* rows only. Because unsettled symbols
    contribute nothing, a disabled `CLAIM ALL` during an unsettled read is "nothing known
    to claim", not a verdict — which is why the button opens a preflight rather than
    signing directly.
- **Action.** Opens the claim-all overlay (`UI-ACTION-CLAIM-ALL-PREFLIGHT` onward). It
  signs nothing on its own: the overlay runs a preflight, then a review, and only
  `UI-ACTION-CLAIM-ALL-CONFIRM` starts the transaction queue.
- **Copy rules.** Button: `CLAIM ALL`. Caption when disabled: `NOTHING CLAIMABLE YET` — the
  `YET` matters, because a zero total may reflect an unsettled read. Never promise a total
  in the button label; never describe the batch as atomic (it is a sequential queue where
  rows can be skipped).
- **Data authority.** `on-chain` for every claimable amount fed into the plan.
  `projection` for the candidate set — and the overlay treats that as blocking: batch
  execution is disabled unless an independent verifier corroborates the discovered
  candidates (`action.md`). A projection may narrow what to ask about; it may never decide
  what is allowed (`../SCHEMAS.md` §2).

## `UI-POSITIONS-LIQUIDITY-CARD`

- **ID.** `UI-POSITIONS-LIQUIDITY-CARD`
- **Purpose.** Show one lending position — its idle amount and rate — and offer its two
  lender actions.
- **Visible when.** Rendered inside an expanded market row, when lending reads succeeded
  and the account has at least one liquidity position or loan pool in that market.
- **States.**
  - `loading` — the whole list renders `LOADING`; no cards.
  - `error` — the whole lending group renders `UNABLE TO LOAD LENDING POSITIONS`
    (`status-negative`) and **no** cards. An error must never render as an empty group.
  - `ready` — card with `LIQUIDITY <id>`, badge `EARNING <apr>`, and `IDLE <amount>`.
  - `idle-zero` — `ADJUST RATE` is disabled (there is nothing to move); `WITHDRAW` stays
    enabled.
- **Action.** `WITHDRAW` opens the withdraw flow (`withdrawLiquidity(positionId)`).
  `ADJUST RATE` opens the adjust flow, which submits one `multicall` of
  `withdrawLiquidity` + `supplyLiquidity` at the new tick. Both are on-chain writes routed
  through the action overlay; neither signs from this card.
- **Copy rules.** `IDLE` means not yet consumed. `EARNING <apr>` describes the rate the
  position is posted at, not realised yield. A lender cannot choose whether their liquidity
  is filled as a loan or as an outright stream purchase — never imply they can. Never
  attach a risk score, health indicator, or liquidation warning to a lending position.
- **Data authority.** `on-chain` for id, rate, and idle amount (hydrated directly).
  `projection` for which positions were discovered.

## `UI-POSITIONS-POOL-CARD`

- **ID.** `UI-POSITIONS-POOL-CARD`
- **Purpose.** Show a loan pool the account lent into, and what it can claim from it.
- **Visible when.** Same condition as `UI-POSITIONS-LIQUIDITY-CARD`; rendered for each of
  the account's pools in that market.
- **States.**
  - `claimable` — `CLAIMABLE <amount>` plus the note
    `SHORTFALLS HARVEST FROM THE LOAN STREAM ON CLAIM`; `CLAIM SHARE` enabled.
  - `nothing-claimable` — claimable is zero; `CLAIM SHARE` disabled and the shortfall note
    is not shown (there is nothing to explain).
  - `loading` / `error` — inherited from the group, as above.
- **Action.** `CLAIM SHARE` opens the claim flow, which calls
  `claimLoanPoolShare(poolId, MAX_UINT128)` — a pro-rata claim that harvests any deficit
  from the open loan stream at claim time.
- **Copy rules.** Amounts are in the market's **ovrfloToken** — pool shares pay out in
  ovrfloToken, not the underlying, and the symbol must say so. The shortfall note must
  stay when there is something to claim: a lender who does not know a claim can harvest
  from the loan stream cannot reason about what they are signing. Never present a pool
  share as fixed or guaranteed.
- **Data authority.** `on-chain` for pool id, rate, and claimable. `projection` for
  discovery.

## `UI-POSITIONS-LOAN-CARD`

- **ID.** `UI-POSITIONS-LOAN-CARD`
- **Purpose.** Show one of the account's loans, how far it has self-repaid, and the actions
  available at its current stage.
- **Visible when.** Lending reads succeeded and the account has at least one loan in this
  market.
- **States.** Three, and they must stay distinct:
  - `repaying` — badge `SELF-REPAYING`, body `OUTSTANDING <amount>`. No primary action;
    `REPAY LOAN` sits behind an `ADVANCED` disclosure because the loan repays itself.
  - `residual` — badge `RESIDUAL RETURNING`, body
    `OBLIGATION MET — STREAM RESIDUAL RETURNS ON CLOSE`.
  - `settled` — badge `SETTLED`, card dimmed, no actions.
  - `CLOSE` renders only when the close can actually succeed (`canCloseLoan`) — an action
    that would revert is not offered.
  - The cyan progress bar carries `role="progressbar"` with an explicit accessible name.
- **Action.** `CLOSE` opens the close flow (`closeLoan(loanId)`), which draws from the
  pledged stream to settle and returns the residual stream to the borrower.
  `REPAY LOAN` (behind `ADVANCED`) opens the repay flow (`repayLoan(loanId, amount)`),
  capped at the outstanding obligation.
- **Copy rules.** The progress bar is **repayment progress**, nothing else. It is not a
  health factor, not a liquidation gauge, and must never be coloured or annotated as risk.
  Never suggest the borrower must repay to avoid a consequence — the defining product fact
  is that the stream repays the loan on schedule and there is no liquidation. `ADVANCED`
  exists to keep manual repayment available without implying it is expected.
- **Data authority.** `on-chain` for loan id, rate, obligation, drawn, repaid, closed flag,
  and the stream's withdrawable that decides closability. `projection` for discovery.
  `pure-client` for the `ADVANCED` disclosure toggle.

## `UI-POSITIONS-STREAM-CARD`

- **ID.** `UI-POSITIONS-STREAM-CARD`
- **Purpose.** Show one eligible stream for this market, how much has streamed, what is
  claimable now, and what it would fetch upfront as a loan.
- **Visible when.** Stream discovery is available **and** the account holds at least one
  stream whose series matches this market.
- **States.**
  - `ready` — badge `<pct>% STREAMED`, gold progress bar, `CLAIMABLE <amount>`.
  - `nothing-claimable` — `CLAIM` disabled when withdrawable is zero.
  - `borrowable` — a borrow teaser exists: `BORROW ~<pct>% UPFRONT`, priced at the best
    liquid tick excluding the user's own supply.
  - `no-liquidity` — no liquid tick: a disabled button reading
    `BORROW STREAM <id>` with the caption `NO LIQUIDITY`. The distinct label is deliberate —
    the market-row `BORROW` button can be on screen simultaneously and two identical
    accessible names are ambiguous.
- **Action.** `CLAIM` opens the claim flow, which calls Sablier
  `withdrawMax(streamId, recipient)` directly. `BORROW` opens the borrow flow pre-scoped to
  this stream.
- **Copy rules.** Amounts are in the market's ovrfloToken. The teaser is prefixed `~` and
  is an estimate at the best liquid tick — it is not a quote and must never be presented as
  one; the binding numbers come from the on-chain `quote` inside the borrow flow. Never
  describe pledging a stream as putting it "at risk of liquidation"; the stream is
  non-cancelable and the residual returns to the borrower.
- **Data authority.** `on-chain` for stream deposited/withdrawn/withdrawable (hydrated from
  Sablier) and for the ladder depth behind the teaser. `projection` for stream discovery.

## `UI-POSITIONS-STREAMS-UNAVAILABLE`

- **ID.** `UI-POSITIONS-STREAMS-UNAVAILABLE`
- **Purpose.** Say plainly that stream discovery failed, and give the user the route that
  does not depend on this app.
- **Visible when.** `useHeldStreams().unavailable` — registry error, registry too large, or
  the projection outcome is `unavailable`.
- **States.** One: rendered, as `status-negative` inside a `STREAMS` group. It replaces the
  stream cards; it never renders alongside a partial list, because a partial list read as
  complete is the failure mode this state exists to prevent.
- **Action.** None — it is a notice, not a control. It names the recovery route: withdraw
  directly from the Sablier lockup contract using the stream id.
- **Copy rules.** Must state three things: discovery is unavailable, the user's streams are
  unaffected, and the direct Sablier address plus "using your stream id". Never render this
  as an empty list, a zero, or a neutral placeholder — a user cut off from the UI needs to
  know their funds are reachable, not to infer they hold nothing.
- **Data authority.** `projection` — this state *is* the projection reporting its own
  incompleteness. It reports nothing about chain state and must never be read as one.

---

## Region copy rules

1. **Never sum across token symbols, and never show fiat.** Every figure is denominated in
   the asset the user actually holds. The no-USD choice is deliberate and recorded
   (`web/components/PositionSummary.tsx`, R31/L-8).
2. **Loading, stale, unavailable, failed, and empty are five different things.** A confident
   empty result standing in for "could not ask" is the specific failure this region guards
   (`PRODUCT.md` principle 5; `../SCHEMAS.md` §1).
3. **No liquidation, health-factor, margin-call, or collateral-ratio framing anywhere.**
   Not as copy, not as a badge, not as a coloured band on a progress bar, not as a
   tooltip. Loans are self-repaying and eligible collateral is a fixed-schedule,
   non-cancelable stream (`PRODUCT.md` — *Positioning*, *Capabilities and Constraints*).
4. **Generative comp fields do not become product facts.** If a value appears in a comp and
   has no product truth behind it, it does not ship — comps win on pixels, briefs win on
   meaning (`../README.md`).
5. **Projection never gates.** Discovery may narrow what the UI asks about; every value
   that reaches an `if (…) allow` is re-read from the authority (`../SCHEMAS.md` §2).
