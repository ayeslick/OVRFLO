# UI coding standard — extracted checklist

Every rule below is **extracted** from a region brief in this directory. Nothing here is
new meaning. When a rule and its source brief disagree, the brief wins — and the fix is
to correct this file, not to reinterpret the brief.

**How to use it.** Run the checklist against a diff (agent or human), cite the rule id in
the finding (`CS-S2`, `CS-B1`), then read the cited brief entry for the full contract. The
brief carries the seven fields; this file carries only the rule.

**What it is not.** Not a control inventory — the 53 controls live in the six briefs and
are not repeated here. Not a second meaning layer. Not a substitute for the mechanisms in
§7; a rule that a grep already decides is listed there, not written out as prose.

Sources: `header.md` · `positions.md` · `markets-table.md` · `settlement.md` ·
`action.md` · `chrome.md` · `../SCHEMAS.md`. Authority order: `../README.md`.

---

## 1. State honesty

- **CS-S1** — Loading, empty, unavailable, failed, truncated, and disconnected each get
  their own rendering. None substitutes for another.
  *`chrome.md` "The five degraded states"; `../SCHEMAS.md` §1.*
- **CS-S2** — A failed read never renders as `0`, and never as a `—` that reads as "none".
  *`UI-MARKETS-TABLE-TVL` · `UI-MARKETS-TABLE-BODY-STATE` · `UI-SETTLEMENT-BALANCES` ·
  `UI-POSITIONS-STREAMS`.*
- **CS-S3** — Not-yet-asked is not empty. An unrequested scan says why the data is absent.
  *`UI-POSITIONS-LOAD` · `UI-CHROME-ROUTE-LOADING`.*
- **CS-S4** — An error replaces the list. Never an empty group, never a partial list that
  reads as complete.
  *`UI-POSITIONS-LIQUIDITY-CARD` · `UI-POSITIONS-STREAMS-UNAVAILABLE`.*
- **CS-S5** — Incomplete is unavailable, not thin. A capped list always discloses the cap.
  *`UI-MARKETS-TABLE-RATES` · `UI-MARKETS-TABLE-TRUNCATION` · `UI-CHROME-TRUNCATION-NOTICE`.*
- **CS-S6** — Unsettledness is scoped to the row or symbol it affects: it never blanks a
  ready sibling and never contributes zero to a total.
  *`UI-POSITIONS-SUPPLIED` · `UI-POSITIONS-CLAIMABLE`.*
- **CS-S7** — Stale is known-but-superseded, and surfaces as forced re-confirmation against
  refreshed numbers — not as a passive badge.
  *`UI-ACTION-TX-STATE` · `UI-ACTION-CONFIRM` (`re-confirm`) · `chrome.md` "stale".*
- **CS-S8** — Failure modes keep their own words: a rejected signature is not a revert, a
  revert is not a generic error, and confirmed-but-refresh-failed is not a failure.
  *`UI-ACTION-TX-STATE` · `action.md` rule 3 · `chrome.md` "confirmed-but-unrefreshed".*
- **CS-S9** — A disabled control names its blocker — unless the blocker is not yet known,
  in which case it stays disabled and silent rather than guessing a reason.
  *`settlement.md` rule 2 · `UI-SETTLEMENT-BORROW` (`disabled-unsettled`).*
- **CS-S10** — Absent ≠ disabled. An action that cannot exist in a state is removed; one
  that is temporarily blocked is disabled with a caption.
  *`settlement.md` rule 3 · `UI-SETTLEMENT-DEPOSIT-PT` · `UI-SETTLEMENT-UNWRAP`.*
- **CS-S11** — No skeleton that resembles data: no placeholder rows, rates, or zeroed
  totals standing in for an unanswered question.
  *`UI-CHROME-ROUTE-LOADING`.*
- **CS-S12** — Disconnected is a precondition, not empty and not an error. One wording,
  `CONNECT WALLET`; no zeros, no red.
  *`UI-CHROME-DISCONNECTED` · `chrome.md` rule 4.*

## 2. Trust domains and gates

- **CS-T1** — Every value that reaches an `if (…) allow` is re-read from the authority.
  Wrong display data misleads; wrong gate data authorises.
  *`../SCHEMAS.md` §2 · `settlement.md` rule 6 · `UI-ACTION-CONFIRM`.*
- **CS-T2** — A projection narrows what to ask about and never decides what is allowed. An
  uncorroborated candidate set **disables** the action rather than permitting it.
  *`UI-ACTION-CLAIM-ALL-PREFLIGHT` · `UI-POSITIONS-CLAIM-ALL` · `action.md` rule 6.*
- **CS-T3** — Projection-backed annotation never changes a submitted argument and never
  gates.
  *`UI-ACTION-DEMAND-ANNOTATION` · `UI-ACTION-RATE-LADDER` (demand cells).*
- **CS-T4** — Promoting a fact from `projection` to `on-chain`, or letting one reach a
  gate, is a trust-domain change: summary ADR plus Owner escalation.
  *`../SCHEMAS.md` §2 · `../REVIEW.md`.*
- **CS-T5** — `pure-client` state may decide what to render or when to ask, never whether
  an action is allowed. Optimistic local bookkeeping may only hide a control.
  *`UI-POSITIONS-LOAD` · `UI-MARKETS-TABLE-BODY-STATE` · `UI-ACTION-APPROVE`.*

## 3. Forbidden product framing

- **CS-P1** — No health factor, liquidation, liquidation price, margin call, or collateral
  ratio: not in copy, captions, tooltips, badges, colour bands, gauges, or column headers.
  OVRFLO has no such mechanism. Partly mechanical — see §7.
  *Region copy rules in all six briefs · `PRODUCT.md` — Positioning.*
- **CS-P2** — Repayment progress is progress, not risk. No warning colouring, no threshold
  marker, no risk gauge beside an obligation.
  *`UI-POSITIONS-LOANS` · `UI-POSITIONS-LOAN-CARD` · `UI-ACTION-QUOTE-SUMMARY`.*
- **CS-P3** — Accent colour is a side marker (lend / borrow / neutral), never a severity
  marker. Borrowing must not be styled as riskier than supplying.
  *`action.md` preamble · `UI-SETTLEMENT-BORROW`.*
- **CS-P4** — A gauge, score, badge, or number that appears only in a comp does not become
  product behaviour. Comps win on pixels; briefs win on meaning.
  *`../README.md` authority order · region rule in every brief.*
- **CS-P5** — No fiat anywhere, and never sum across token symbols. Every figure names the
  token actually moved or received.
  *`header.md` rule 4 · `positions.md` rule 1 · `UI-POSITIONS-CLAIMABLE` · `UI-ACTION-QUOTE-SUMMARY`.*
- **CS-P6** — Never promise an outcome the contract can clamp, never present a confirm as
  reversible, and never present a `~` estimate as a quote.
  *`UI-ACTION-CONFIRM` · `UI-ACTION-RATE-LADDER` · `UI-POSITIONS-STREAM-CARD`.*
- **CS-P7** — A pledged stream is never described as collateral at risk, and a deposit is
  never described as locking collateral or taking on a loan.
  *`UI-POSITIONS-STREAMS` · `UI-POSITIONS-STREAM-CARD` · `UI-SETTLEMENT-DEPOSIT-PT`.*

## 4. Supply / Borrow peer semantics

- **CS-B1** — SUPPLY and BORROW stay peers: same row, same size, same caption mechanism,
  neither nested, tabbed, ghost-styled, or presented as the default. A change here amends
  `settlement.md`; it is not a visual tweak.
  *`settlement.md` preamble + rule 1 · `UI-SETTLEMENT-SUPPLY` · `UI-SETTLEMENT-BORROW`.*
- **CS-B2** — Both render while disconnected, both disabled, both captioned
  `CONNECT WALLET`, so the two sides of a market are visible before a wallet is connected.
  *`UI-CHROME-DISCONNECTED` · `UI-SETTLEMENT-SUPPLY`.*
- **CS-B3** — Every rate appears in both lenses: APR is the lender lens, upfront percentage
  the borrower lens, and they are one deterministic per-market conversion, not two products.
  *`markets-table.md` rule 1 · `UI-MARKETS-TABLE-RATES` · `UI-ACTION-RATE-LADDER`.*
- **CS-B4** — Copy stays symmetric in tone. Neither side is the "safe" side and neither is
  the "advanced" side.
  *`UI-SETTLEMENT-SUPPLY` · `UI-SETTLEMENT-BORROW` copy rules.*
- **CS-B5** — A lender does not choose whether liquidity fills as a loan or as an outright
  stream purchase. Never imply they can; the flow says so before the decision.
  *`UI-SETTLEMENT-SUPPLY` · `UI-POSITIONS-LIQUIDITY-CARD`.*
- **CS-B6** — Borrow-side depth excludes the user's own supply and says so; supply-side
  `WAITING` includes it. Depth is never presented as a guaranteed fill.
  *`UI-ACTION-RATE-LADDER` · `UI-POSITIONS-STREAM-CARD`.*

## 5. Overlay and shell consistency

- **CS-M1** — Everything that costs a signature happens in the overlay, and nothing signs
  what the user has not seen: asset, amount, rate, fee, and on-chain consequence first.
  *`action.md` preamble + rule 1 · `UI-ACTION-QUOTE-SUMMARY`.*
- **CS-M2** — One chain gate, at the write seam, replacing the form body for every action.
  No header network switcher — informing without preventing is not a gate.
  *`UI-ACTION-NETWORK-GATE` · `header.md` Boundary.*
- **CS-M3** — Approval is a separate, exact, visible step. It never renders `CONFIRMED`, is
  never live at the same time as confirm, and the step count matches the signatures
  actually required.
  *`UI-ACTION-APPROVE` · `UI-ACTION-STEPS` · `action.md` rule 2.*
- **CS-M4** — The user can always leave. The error boundary wraps the form body only, with
  the header and close control outside it, and closing never implies cancelling a
  broadcast transaction.
  *`UI-ACTION-OVERLAY` · `UI-ACTION-ERROR-BOUNDARY` · `UI-CHROME-MODAL-ERROR-BOUNDARY`.*
- **CS-M5** — An account change resets the open form and clears the expanded row and any
  open overlay. Never silently re-scope half-entered inputs to a new account.
  *`UI-ACTION-WALLET-CHANGED` · `UI-HEADER-WALLET` · `UI-MARKETS-TABLE-ROW-TOGGLE`.*
- **CS-M6** — A batch is never described as atomic, skipped rows are always reported, and
  the plan is rebuilt from live values at submit time rather than from a review snapshot.
  *`UI-ACTION-CLAIM-ALL-QUEUE` · `UI-ACTION-CLAIM-ALL-CONFIRM`.*
- **CS-M7** — Accessibility contracts named in a brief are part of the control, not polish:
  `aria-expanded` on the button rather than the `<tr>`; the rate ladder is a `radiogroup`;
  validation and balance are associated via `aria-describedby`; a truncated value always
  keeps a recovery path.
  *`UI-MARKETS-TABLE-ROW-TOGGLE` · `UI-ACTION-RATE-LADDER` · `UI-ACTION-AMOUNT` ·
  `UI-HEADER-ADDRESS-COPY`.*
- **CS-M8** — What was simulated is what is submitted: the reviewed calldata is the
  submitted calldata, and any drift between review and submission routes through visible
  re-confirmation, never silent re-submission with new values.
  *`action.md` rule 7 · `UI-ACTION-CONFIRM` (`re-confirm`) · `UI-ACTION-CLAIM-ALL-CONFIRM`.*
- **CS-M9** — The wallet session is volatile external state: an in-flight operation stays
  attributed to the identity captured at its start, and an account, chain, or connection
  change during it pauses or re-asks — it never silently adopts the new session.
  *`chrome.md` rule 7 · `UI-ACTION-WALLET-CHANGED` · `UI-ACTION-CLAIM-ALL-QUEUE` (`paused`).*

## 6. Scope and amendment

- **CS-X1** — Six regions, fixed at pass 1. A surface that seems to need a seventh is a
  signal to re-read the boundaries, not to add a region.
  *`README.md` (this directory).*
- **CS-X2** — Adding a control, changing when one is visible, or changing which trust
  domain backs a displayed fact amends the brief first. Code that contradicts a brief is a
  defect in the code.
  *`../README.md` authority order · `UI-HEADER-BRAND` · `UI-MARKETS-TABLE-BODY-STATE`.*
- **CS-X3** — Aggregate surfaces stay account-independent: no account-scoped figure in a
  table row, and no historical scan before the user opens a market or loads positions.
  *`markets-table.md` "Initial-view constraint" + rule 2 · `UI-POSITIONS-LOAD`.*

## 7. Already mechanical — do not restate as prose

Where a rule is decided by a tool, cite the tool. Extend the mechanism rather than adding
a review paragraph.

| Rule | Mechanism |
|---|---|
| No `console.*` in the production bundle | `no-console` in `web/eslint.config.mjs` (`npm --prefix web run lint`) |
| No ad hoc historical log scans outside `lib/discovery` (+ the `deployment.ts` anchor) | `web/scripts/check-banned-patterns.sh` |
| No fiat helper surface (`nativeUsd`) — CS-P5's mechanical slice | same script |
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
