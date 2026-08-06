# 06 — BORROW mode: ladder, quote, router wiring, re-quote recovery

**What to build:** The complete borrow experience, replacing today's hardcoded single rate. The borrower picks a stream, sees a tick ladder of every rate that currently has real liquidity (each showing the upfront percentage they'd receive and available depth), gets a live on-chain quote for their entered amount, and can adjust their slippage tolerance. When the amount exceeds what's available at the selected rate, they see a partial-fill quote plus an explicit "see other options" prompt (never an auto-presented list — picking a different rate is a conscious choice). If liquidity shifts between quoting and submitting, the form automatically re-quotes and shows a clear "liquidity changed, here's the new number" recovery path rather than a dead-end error.

**Blocked by:** 01 — Display math for outcome-first pricing, 02 — Borrow router + claim-all planner, 03 — Data-layer fixes: invalidation, confirmation state, real symbols, 04 — Expandable markets table + slim action overlay

**Status:** resolved

- [x] Ladder defaults to the lowest rate that currently has liquidity, marked as the best option
- [x] A footnote appears when the user has their own liquidity at the market (their own supply is always excluded from what they can borrow against)
- [x] Entering an amount above the selected rate's available depth shows a partial-fill quote at that rate, with a "show other options" button — the alternative rate is not shown until clicked
- [x] When no rate anywhere fully covers the amount, only the partial-fill option is shown, with no "show other options" button
- [x] Selecting the alternative rate updates the ladder's selection and the quote panel together
- [x] Slippage tolerance is user-editable (sensible default, reasonable min/max range) and directly controls the minimum-acceptable-amount protection on submission
- [x] A liquidity race (quote goes stale between quoting and signing) triggers an automatic re-quote with a clear banner and a single re-confirm action — never a dead-end error for this specific failure mode
- [x] Other revert reasons (e.g. genuinely ineligible stream, self-matching your own liquidity) show a terminal error with no misleading "just retry" affordance
- [x] After confirmation, the actual received amount is parsed from the transaction receipt and displayed — flagged distinctly if it differs from the quoted amount (a partial fill can succeed without reverting)
- [x] A market past maturity never runs the router or ladder against it
- [x] Truncated-liquidity-list warning (from Ticket 03) surfaces inside the ladder when relevant

## Comments

**2026-07-27 (agent):** Resolved (see `git log` for `feat(web): borrow mode ladder, live quotes, and re-quote recovery`). New pure module `web/lib/borrow.ts` (tick resolution with best-default, selection-scoped partial planning with click-gated alternative, slippage parsing 0.1–5% default 0.5%, stale/terminal/retryable error classification incl. `OVRFLOLending: slippage` as a race, receipt parsing of `BorrowerLoanPoolCreated` filtered by emitter). `BorrowForm` rewritten: ladder radiogroup (upfront % via `upfrontBps`, depth, BEST badge, own-supply footnote, R-truncation warning), full-quote grossPrice clamp before the fill quote, gather-driven ids, stale revert → `invalidateAllOnChainReads` + banner + single RE-CONFIRM, terminal reverts disable (never hide, DESIGN.md §8) with stream-change reset re-arming the form, receipt-parsed RECEIVED with distinct PARTIAL FILL flag (contributed < submitted target), matured gate on first render (lazy clock init). `useWriteFlow` now exposes `receipt` and `reset`. 32 new tests (18 lib + 11 component + 1 receipt-forgery), suite 120/120; tsc/eslint/banned-patterns clean. Two-axis review applied: fixed `--accent-cyan` var, terminal-traps-form, receipt address filter, partial-flag semantics. Noted, not changed: ticks outside current APR bounds are unquotable on-chain (`_validateApr` reverts), so live positions at retired rates are intentionally absent from the ladder; dead-helper cleanup (borrowQuoteCopy/staleBatchCopy) spun off as a follow-up task.
