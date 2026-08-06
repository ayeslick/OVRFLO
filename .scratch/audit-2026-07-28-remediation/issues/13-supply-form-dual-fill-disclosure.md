# 13 — Supply-form dual-fill disclosure

**Category:** feature (disclosure) + regression guard

**Covers:** R35 (Tranche 4), R46 (Tranche 5). Findings: M-3.

**What to build:** The supply form tells a lender their liquidity may be filled either as a loan or as an outright stream purchase, and a stream acquired through a sale fill correctly appears in the buyer's positions view.

**Details:**
- R35: add disclosure copy to the supply form stating liquidity posted may be filled as a loan (self-repaying, backed by a pledged Sablier stream) or as an outright sale (stream transferred at the agreed discount). This is disclosure only — no new listing UI, no acquisition-origin badge (a sale is a purchase at an agreed discount; the buyer doesn't need to be told they bought something after the fact).
- R46: `PositionList` already filters held streams through `isSeriesMatchedStream` and renders a card per stream, so an acquired stream already appears correctly — this requirement is satisfied by existing code. Add a regression test locking that in, so a future change can't silently break it.

**Acceptance criteria:**
- [x] Supply form states, before submission, that posted liquidity may be filled as a loan or as an outright stream purchase
- [x] AE-equivalent: given A1 supplies liquidity and A2 fills it via sale rather than loan, the acquired stream appears in A1's positions view with value and maturity
- [x] A regression test covers the sale-fill → appears-in-positions path explicitly (not just relying on existing coverage)
- [x] No new listing UI (post/buy/cancel) built — out of scope
- [x] No acquisition-origin badge added — out of scope

**Out of scope:**
- Listing UI (`postSaleListing`/`buyListing`/`cancelSaleListing` stay contract-only, no UI built)
- Provenance marker distinguishing sale-acquired vs. deposited streams

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4/5 boundary — F2 flow, AE covers R35+R46 together).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Sits across the plan's tranche 4/5 boundary because F2 (the "lender filled as a sale" flow) ties these two requirements together — kept as one ticket rather than split by tranche number.

**2026-07-29 (implemented):** Landed as U13 on branch `fix/audit-2026-07-28-tranche-1`.

*Disclosure (R35/M-3).* The supply form now states, before submission, that liquidity may be filled as a loan or as an outright stream purchase and that a lender cannot restrict it to one. It sits above the summary row rather than below it — the two outcomes leave the lender holding different things (a loan claim versus the stream NFT), so it belongs before the decision, not after it.

*R46 moved to the E2E tier, per doc review.* The plan originally called for a component-level regression test. That would have passed on hand-fed data: `position-cards.test.tsx` mocks `useHeldStreams` wholesale, so it only proves `PositionList` renders a stream it was handed. The chain that can actually regress is `sellStreamToLiquidity` transferring the NFT, then Ponder's `Transfer` handler rewriting `recipient` in `sablier_streams`, then the app discovering it — the discovery hop critical pattern #1 warns about, and the part a mock erases.

New fixtures: `sellStreamIntoLiquidity` and `readLatestLiquidityId`. The scenario has the app's own wallet supply the liquidity, a second persona deposit PT for a stream and sell it in, then asserts the acquired stream appears in the buyer's positions view. It drives the contract directly because there is no sell-side form — listings stay contract-only by scope — so this is the only way to produce the state the view has to render.

No provenance marker was added: a sale is a purchase at an agreed discount, and the buyer does not need to be told after the fact what they bought.

Verification: 417 unit tests, 32 E2E scenarios (up from 31), lint and `tsc --noEmit` clean.
