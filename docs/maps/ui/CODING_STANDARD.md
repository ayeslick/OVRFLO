# UI coding standard — extracted checklist

Every rule below is **extracted** from a region brief in this directory. Nothing here is
new meaning. When a rule and its source brief disagree, the brief wins — and the fix is
to correct this file, not to reinterpret the brief.

**How to use it.** Run the checklist against a diff (agent or human), cite the rule id in
the finding (`CS-S2`, `CS-B1`), then read the cited brief entry for the full contract. The
brief carries the seven fields; this file carries only the rule.

**What it is not.** Not a control inventory — the controls live in the eight briefs and
are not repeated here. Not a second meaning layer. Not a substitute for the mechanisms in
§7; a rule that a grep already decides is listed there, not written out as prose.

Sources: `shell.md` · `watch.md` · `borrow.md` · `supply.md` · `rates.md` · `review.md` ·
`assets.md` · `first-run.md` · `../SCHEMAS.md`. Authority order: `../README.md`.
Region set: `docs/adr/0001-watch-surface-region-set.md`.

---

## 1. State honesty

- **CS-S1** — Loading, empty, unavailable, failed, truncated, and disconnected each get
  their own rendering. None substitutes for another.
  *`UI-SHELL-STATUS` · `UI-SHELL-ENTRY-SYNCING` · `UI-WATCH-STREAMS-DEGRADED` ·
  `UI-BORROW-SELECT-STREAM` · `UI-SUPPLY-SELECT-MARKET` · `UI-RATES-LADDER` ·
  `../SCHEMAS.md` §1.*
- **CS-S2** — A failed read never renders as `0`, and never as a `—` that reads as "none".
  *`UI-SHELL-ROUTE-LOADING` · `UI-SUPPLY-AMOUNT` (`loading-balance`) ·
  `UI-BORROW-FACTS` (`unavailable`) · `UI-WATCH-WALL`.*
- **CS-S3** — Not-yet-asked is not empty. An unrequested or in-flight scan says why the
  data is absent.
  *`UI-SHELL-ENTRY-SYNCING` · `UI-WATCH-LENS` (pending is not a confirmed-zero hide) ·
  `UI-FIRST-RUN-SURFACE`.*
- **CS-S4** — An error replaces the list. Never an empty group, never a partial list that
  reads as complete.
  *`UI-WATCH-STREAMS-DEGRADED` · `UI-SHELL-REGION-BOUNDARY` ·
  `UI-BORROW-SELECT-STREAM` (`unavailable`) · `UI-RATES-LADDER` (`unavailable`).*
- **CS-S5** — Incomplete is unavailable, not thin. A capped list always discloses the cap.
  *`UI-SHELL-TRUNCATION`.*
- **CS-S6** — Unsettledness is scoped to the row or symbol it affects: it never blanks a
  ready sibling and never contributes zero to a total.
  *`UI-WATCH-ROW-SUPPLIED` · `UI-WATCH-FRESHNESS` · `UI-WATCH-WALL`.*
- **CS-S7** — Stale is known-but-superseded, and surfaces as forced re-confirmation
  against refreshed numbers — not as a passive badge.
  *`UI-REVIEW-STALE` · `UI-BORROW-QUOTE-UPDATED` · `UI-SHELL-STATUS` (`degraded`).*
- **CS-S8** — Failure modes keep their own words: a rejected signature is not a revert, a
  revert is not a generic error, and confirmed-but-refresh-failed is not a failure.
  *`UI-REVIEW-TX-STATE` · `review.md` rule 5.*
- **CS-S9** — A disabled control names its blocker — unless the blocker is not yet known,
  in which case it stays disabled and silent rather than guessing a reason.
  *`UI-WATCH-CLAIM` (`disabled-stale`) · `UI-WATCH-CLOSE` · `UI-BORROW-STEPPER` ·
  `UI-SUPPLY-STEPPER`.*
- **CS-S10** — Absent ≠ disabled. An action that cannot exist in a state is removed; one
  that is temporarily blocked is disabled with a caption.
  *`UI-WATCH-CLAIM` (removed at zero claimable) · `UI-WATCH-WITHDRAW` ·
  `UI-WATCH-BORROW-ROUTE` · `UI-ASSETS-UNWRAP` (removed when `UI-ASSETS-CLAIM-PT`
  replaces it).*
- **CS-S11** — No skeleton that resembles data: no placeholder rows, rates, ribbons, or
  zeroed totals standing in for an unanswered question.
  *`UI-SHELL-ROUTE-LOADING` · `UI-SHELL-ENTRY-SYNCING` · `first-run.md` rule 2.*
- **CS-S12** — Disconnected is a precondition, not empty and not an error. One wording,
  `CONNECT WALLET`; no zeros, no red, no "you have no positions".
  *`UI-SHELL-ENTRY-DISCONNECTED` · `UI-SHELL-WALLET` · `shell.md` rule 1.*

## 2. Trust domains and gates

- **CS-T1** — Every value that reaches an `if (…) allow` is re-read from the authority.
  Wrong display data misleads; wrong gate data authorises.
  *`../SCHEMAS.md` §2 · `review.md` rule 6 · `UI-REVIEW-CONFIRM`.*
- **CS-T2** — A projection narrows what to ask about and never decides what is allowed.
  Discovery pending or could-not-ask never asserts emptiness and never first-run.
  *`UI-WATCH-STREAMS-DEGRADED` · `UI-BORROW-SELECT-STREAM` · `UI-WATCH-BORROW-ROUTE` ·
  `UI-FIRST-RUN-SURFACE` · `watch.md` rule 6.*
- **CS-T3** — Schedule interpolation and USD are display. Interpolation never authorises;
  USD never appears on receipts, in calldata, or at a write gate.
  *`UI-WATCH-HERO-EARNINGS` · `UI-WATCH-RIBBON` · `UI-WATCH-CLAIM` ·
  `UI-SHELL-TOKEN-USD` · `UI-REVIEW-PERMISSION-RECEIPT` · `UI-REVIEW-ACTION-RECEIPT`.*
- **CS-T4** — Promoting a fact from `projection` to `on-chain`, or letting one reach a
  gate, is a trust-domain change: summary ADR plus Owner escalation.
  *`../SCHEMAS.md` §2 · `../REVIEW.md`.*
- **CS-T5** — `pure-client` state may decide what to render or when to ask, never whether
  an action is allowed. Optimistic local bookkeeping may only hide a control.
  *`UI-WATCH-LENS` · `UI-REVIEW-APPROVE` · `UI-SHELL-TOKEN-USD`.*

## 3. Forbidden product framing

- **CS-P1** — No health factor, liquidation, liquidation price, margin call, or collateral
  ratio: not in copy, captions, tooltips, badges, colour bands, gauges, or column headers.
  OVRFLO has no such mechanism. Partly mechanical — see §7.
  *Region copy rules in all eight briefs · `PRODUCT.md` — Positioning.*
- **CS-P2** — Repayment progress is progress, not risk. No warning colouring, no threshold
  marker, no risk gauge beside an obligation or pool band.
  *`UI-WATCH-HERO-OUTSTANDING` · `UI-WATCH-RIBBON` · `UI-BORROW-POOL-BAND` ·
  `UI-REVIEW-CLOSE` (never "liquidate").*
- **CS-P3** — Gold marks value movement and the active operation, never severity.
  Borrowing must not be styled as riskier than supplying.
  *`UI-WATCH-HERO-EARNINGS` · `UI-SHELL-NAV` · `UI-BORROW-POOL-BAND`.*
- **CS-P4** — A gauge, score, badge, or number that appears only in a comp does not become
  product behaviour. Comps win on pixels; briefs win on meaning.
  *`../README.md` authority order · `watch.md` rule 8 · `shell.md` rule 7.*
- **CS-P5** — USD is a reference beside the token amount, never a replacement. Receipts
  stay token-exact. Never present a USD figure as the amount that will move. Never sum
  across token symbols. Every committed figure names the token actually moved.
  *`UI-SHELL-TOKEN-USD` · `UI-REVIEW-PERMISSION-RECEIPT` · `UI-REVIEW-ACTION-RECEIPT` ·
  `review.md` rule 4 · `shell.md` rule 4.*
- **CS-P6** — Never promise an outcome the contract can clamp, never present a confirm as
  reversible, and never present a `~` estimate as a quote.
  *`UI-BORROW-PARTIAL-FILL` · `UI-REVIEW-CONFIRM` · `UI-WATCH-HERO-OUTSTANDING` ·
  `UI-BORROW-FACTS`.*
- **CS-P7** — A pledged stream is never described as collateral at risk, and a deposit is
  never described as locking collateral or taking on a loan.
  *`UI-WATCH-DETAIL-STREAM` · `UI-REVIEW-STREAM-DEPOSIT` · `UI-ASSETS-STREAM-ENTER-PT` ·
  `UI-FIRST-RUN-RISK`.*

## 4. Supply / Borrow peer semantics

- **CS-B1** — SUPPLY and BORROW stay peers: same nav row, same size, same caption
  mechanism, neither nested, tabbed, ghost-styled, or presented as the home. Home is the
  watch surface (or first-run / disconnected entry). A change here amends `shell.md`.
  *`UI-SHELL-NAV` · `UI-SHELL-ENTRY-DISCONNECTED` · `shell.md` preamble.*
- **CS-B2** — Both nav launches remain reachable while disconnected. Following them lands
  on the flow's first decision, which then asks for a wallet where a write would need one.
  *`UI-SHELL-NAV` · `UI-SHELL-ENTRY-DISCONNECTED` · `UI-SHELL-WALLET`.*
- **CS-B3** — Every rate appears in both lenses: APR is the lender lens, the same tick is
  the borrower lens, one `tickDepths` read, not two products.
  *`UI-SUPPLY-RATE-WINDOW` · `UI-BORROW-RATE-WINDOW` · `UI-RATES-LADDER` ·
  `rates.md` rule 2.*
- **CS-B4** — Copy stays symmetric in tone. Neither side is the "safe" side and neither is
  the "advanced" side.
  *`UI-SHELL-NAV` · `UI-SUPPLY-FACTS` · `UI-BORROW-FACTS`.*
- **CS-B5** — A lender does not choose whether liquidity fills as a loan or as an outright
  stream purchase. Never imply they can; sale equivalence is named on the borrow side
  when the draw is the stream's remaining face.
  *`UI-SUPPLY-FACTS` · `UI-BORROW-SALE-EQUIVALENCE`.*
- **CS-B6** — Depth is never a guaranteed fill. v1-lite has no self-match guard on blind
  fill: do not print a "your own supply excluded" footnote the contract does not enforce.
  Partial fill is named before signing.
  *`UI-RATES-ROW` · `UI-BORROW-PARTIAL-FILL` · `UI-BORROW-POOL-BAND` ·
  `UI-SUPPLY-QUEUE-BAND` · `rates.md` rule 3.*

## 5. Review and shell consistency

- **CS-M1** — Everything that costs a signature happens in review, and nothing signs what
  the user has not seen: asset, amount, rate, fee, and on-chain consequence first.
  *`review.md` preamble + rule 1 · `UI-REVIEW-ACTION-RECEIPT` · `UI-REVIEW-SPLIT`.*
- **CS-M2** — One chain gate, at the write seam, replacing the form body for every action.
  No header-only network indicator — informing without preventing is not a gate.
  *`UI-SHELL-NETWORK-GATE`.*
- **CS-M3** — Approval is a separate, exact, visible step. It never renders `CONFIRMED`,
  is never live at the same time as confirm, and skip-without-renumber keeps remaining
  stage labels when allowance already covers.
  *`UI-REVIEW-APPROVE` · `UI-REVIEW-SETTLEMENT-TRACE` · `review.md` rules 2–3.*
- **CS-M4** — The user can always leave. The error boundary wraps the form body only, with
  the header and close control outside it, and closing never implies cancelling a
  broadcast transaction.
  *`UI-REVIEW-ERROR-BOUNDARY` · `UI-SHELL-REGION-BOUNDARY`.*
- **CS-M5** — An account change resets the open form and clears watch selection. Never
  silently re-scope half-entered inputs to a new account.
  *`UI-SHELL-WALLET-CHANGED` · `UI-SHELL-WALLET` · `UI-WATCH-SELECT`.*
- **CS-M6** — Claim is per-position, one Multicall of that position's loans. There is no
  cross-position Claim-All. A gas-capped continuation is "claim remaining", never an
  atomic sweep, and skipped pairs are reported.
  *`UI-WATCH-CLAIM` · `UI-REVIEW-CLAIM`.*
- **CS-M7** — Accessibility contracts named in a brief are part of the control, not polish:
  lens switcher is an APG tablist; ticking heroes are `role="timer"`; bands are
  `role="meter"` with `aria-valuetext`; ALL RATES is a `radiogroup`; stepper paddles are
  plain labeled buttons; disclosures are `<button aria-expanded>` or native `<details>`.
  *`UI-WATCH-LENS` · `UI-WATCH-HERO-EARNINGS` · `UI-WATCH-HERO-OUTSTANDING` ·
  `UI-WATCH-CAPITAL-BAND` · `UI-RATES-LADDER` · `UI-BORROW-STEPPER` ·
  `UI-SUPPLY-STEPPER`.*
- **CS-M8** — What was simulated is what is submitted: the reviewed calldata is the
  submitted calldata, and any drift between review and submission routes through visible
  re-confirmation, never silent re-submission with new values.
  *`review.md` rule 8 · `UI-REVIEW-CONFIRM` · `UI-REVIEW-STALE` ·
  `UI-BORROW-QUOTE-UPDATED`.*
- **CS-M9** — The wallet session is volatile external state: an in-flight operation stays
  attributed to the identity captured at its start, and an account, chain, or connection
  change during it pauses or re-asks — it never silently adopts the new session.
  *`shell.md` rule 6 · `UI-SHELL-WALLET` · `UI-SHELL-WALLET-CHANGED`.*

## 6. Scope and amendment

- **CS-X1** — Eight regions, fixed until another Owner-approved charter edit:
  `SHELL`, `WATCH`, `BORROW`, `SUPPLY`, `RATES`, `REVIEW`, `ASSETS`, `FIRST-RUN`.
  SETTLEMENT trace and PERMISSION / ACTION receipts are shared families inside
  `review.md`, not a ninth region. A surface that seems to need a ninth is a signal to
  re-read the boundaries, not to add a region.
  *`README.md` (this directory) · `docs/adr/0001-watch-surface-region-set.md`.*
- **CS-X2** — Adding a control, changing when one is visible, or changing which trust
  domain backs a displayed fact amends the brief first. Code that contradicts a brief is a
  defect in the code.
  *`../README.md` authority order · `UI-SHELL-BRAND` · `UI-WATCH-WALL`.*
- **CS-X3** — The watch surface is home for a connected wallet that holds any protocol
  object. First-run renders only on confirmed emptiness of positions, loans, and stream
  truth. There is no LOAD POSITIONS consent gate and no POSITIONS nav item.
  *`UI-WATCH-WALL` · `UI-FIRST-RUN-SURFACE` · `UI-SHELL-NAV` · `UI-SHELL-ENTRY-SYNCING`.*

## 7. Already mechanical — do not restate as prose

Where a rule is decided by a tool, cite the tool. Extend the mechanism rather than adding
a review paragraph.

| Rule | Mechanism |
|---|---|
| No `console.*` in the production bundle | `no-console` in `web/eslint.config.mjs` (`npm --prefix web run lint`) |
| No ad hoc historical log scans outside `lib/discovery` (+ the `deployment.ts` anchor) | `web/scripts/check-banned-patterns.sh` |
| No ETH≈USD helper surface (`nativeUsd`) — CS-P5's mechanical slice; the sanctioned path is Chainlink stETH/USD × `stEthPerToken` | same script |
| No health-factor / liquidation-price / collateral-ratio identifier or copy — CS-P1's mechanical slice | same script |
| Superseded APIs (`useApprovedMarkets`, `parseStreamError`, `FACTORY_FROM_BLOCK`) | same script |
| No `Number(...)` cast of a token amount — money values stay `bigint` | same script |

Both are wired into `npm --prefix web run test` (via `pretest`) and
`npm --prefix web run lint:security`. Guard behaviour is itself tested in
`web/tests/scripts/banned-patterns.test.ts`.

**Adding an entry.** Pattern and rationale are joined by `:::`, not `|`, so a pattern may
use regex alternation. Keep patterns POSIX-ERE-compatible — the script falls back to
`grep -E` where ripgrep is absent, which has no inline `(?i)` flag; write `[Aa]mount`
rather than `(?i)amount`. A pattern that fails to compile now aborts the run instead of
being reported as clean, so a malformed entry is caught the first time CI runs it.
