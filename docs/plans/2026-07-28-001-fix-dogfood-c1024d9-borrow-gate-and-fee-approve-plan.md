---
title: "Dogfood follow-ups: BORROW liquidity pre-gate + 2% fee approve buffer"
type: fix
date: 2026-07-28
topic: dogfood-c1024d9-borrow-gate-and-fee-approve
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: .scratch/dogfood-c1024d9-followups/issues/
execution: code
origin_tickets:
  - .scratch/dogfood-c1024d9-followups/issues/03-borrow-button-liquidity-pregate.md
  - .scratch/dogfood-c1024d9-followups/issues/04-decide-deposit-fee-approve-strategy.md
---

# Dogfood follow-ups: BORROW liquidity pre-gate + 2% fee approve buffer - Plan

## Goal Capsule

- **Objective:** Close two dogfood follow-ups from `docs/dogfood-reports/2026-07-28-c1024d9-dogfood.md`: (1) disable the market-row `BORROW` button when the market has zero postable liquidity so borrowers cannot open a flow that still requires signing `APPROVE STREAM` before discovering the empty ladder; (2) approve deposit fee-token amounts with a 2% buffer so block-to-block fee requotes do not strand the deposit modal on `APPROVE wstETH` after a successful exact-fee approve.
- **Product authority:** Tickets `03-borrow-button-liquidity-pregate.md` and `04-decide-deposit-fee-approve-strategy.md` under `.scratch/dogfood-c1024d9-followups/issues/`. Maintainer decisions in those tickets win on WHAT. This plan wins on HOW.
- **Product Contract preservation:** Product Contract transcribed from those tickets without scope change — `session-settled:` annotations mark maintainer decisions already closed.
- **Execution profile:** code — TypeScript/React in `web/` only. No Solidity, no Ponder schema changes.
- **Stop conditions:** Both tickets' acceptance criteria checked off; `npm --prefix web run test` green; affected e2e scenarios updated and runnable under `bootstrap:e2e`.
- **Open blockers:** none.

---

## Product Contract

### Summary

Two small, independent product fixes on the existing markets console. The market-row `BORROW` control becomes a live liquidity gate using the same "best liquid tick" signal already used by stream cards. Deposit fee approvals gain a fixed 2% headroom so tiny oracle/TWAP fee drift does not force a second approve — without ever using unlimited ERC-20 approval.

### Problem Frame

**Borrow pre-gate.** `MarketRowDetail` enables market-row `BORROW` whenever the wallet has an eligible stream (after wallet/lending/maturity captions). `PositionList`'s `StreamCard` already shows a disabled `BORROW STREAM {id}` + `NO LIQUIDITY` when `teaserBps === null`, but the market-row button stays clickable. Opening BORROW still lets the user reach `APPROVE STREAM` (a real on-chain write) before the modal surfaces `NO LIQUIDITY POSTED AT ANY RATE`. That wasted signature is the harm; submission itself was already blocked inside the modal.

**Fee approve buffer.** ConvertForm's deposit path approves exactly `feeAmount` from `previewDeposit`. `convertApprovalNeeds` then compares live `feeAmount` to allowance and optimistic `underlyingApprovedAmount`. When the next preview tick raises the fee by a few wei above the approved amount, the UI falls back to `APPROVE {underlying}` even though the prior approve confirmed — the dogfood paper cut for the yield-cyclist persona.

### Requirements

- R1. Market-row `BORROW` is disabled with caption `NO LIQUIDITY POSTED AT ANY RATE` when the market has zero postable (non-self) liquidity at any rate, for a connected wallet that otherwise has an eligible stream. Caption joins the existing `borrowCaption` chain: disconnected → lending not deployed/matured → no eligible streams → **no liquidity** → enabled.
- R2. The liquidity gate is live: once any qualifying liquidity appears, the button re-enables without a page reload (same read freshness as today's ladder/teaser).
- R3. Liquidity signal reuses the market-level ladder/teaser path already used by `PositionList` (`useLending` for lending params + `useLendingLiquidity` + `aprChoices` + `buildLadder` + `borrowTeaserBps`; empty when `teaserBps === null`) — no second independent liquidity fetch inventing a different "empty" definition.
- R4. Modal no-liquidity handling (`NO LIQUIDITY POSTED AT ANY RATE` + disabled submit) remains as defense in depth.
- R5. Stream-card `BORROW STREAM {id}` / `NO LIQUIDITY` copy from `c1024d9` is unchanged.
- R6. On deposit `APPROVE {underlying}`, approve amount is `feeAmount * 102n / 100n` (2% buffer), never exact `feeAmount` and never `type(uint256).max` / unlimited.
- R7. After a buffered approve, if the live re-quoted fee stays `<=` the approved amount (and/or on-chain allowance covering that fee), the UI advances to `DEPOSIT` without a second approve prompt.
- R8. If a re-quote exceeds the buffered approved amount, falling back to `needsUnderlyingApproval` and re-prompting approve is correct behavior.
- R9. Wrap-mode underlying approve stays exact `amount` (ticket 04 out of scope for wrap). PT approve path unchanged.
- R10. No `type(uint256).max` (or equivalent infinite) approval on the frontend fee-approval path.

### Actors

- A1. Stream borrower — holds an eligible stream; must not be walked into `APPROVE STREAM` when the market has no postable liquidity.
- A2. Yield cyclist / depositor — deposits PT and pays a wstETH fee; must not be stranded on a second fee approve for sub-2% fee drift.
- A3. Liquidity lender — posting liquidity must unblock market-row `BORROW` for borrowers without requiring borrowers to reload.

### Key Flows

- F1. Expand market with eligible stream and zero postable liquidity → market-row `BORROW` disabled + `NO LIQUIDITY POSTED AT ANY RATE` → no modal open, no on-chain borrow-adjacent write.
- F2. Same market, lender posts liquidity → market-row `BORROW` enables → borrower can open modal and proceed.
- F3. Deposit PT → `APPROVE PT` (if needed) → `APPROVE {underlying}` for buffered fee → fee requotes within 2% → `DEPOSIT` enabled without second fee approve.
- F4. Deposit PT → buffered fee approve → fee requotes beyond 2% → `APPROVE {underlying}` shown again.

### Acceptance Examples

- AE1. Connected wallet with stream, empty ladder: market-row `BORROW` disabled; caption `NO LIQUIDITY POSTED AT ANY RATE`; stream card still shows `BORROW STREAM #{id}` + `NO LIQUIDITY`.
- AE2. After arrange/supply posts liquidity at any tick: market-row `BORROW` enables without reload.
- AE3. Unit/e2e: approve mined for buffered fee; next preview fee `+1%` → deposit step, not second approve.
- AE4. Unit: preview fee `+3%` above buffered approve → `needsUnderlyingApproval` true again.

### Scope Boundaries

**In scope**

- `MarketRowDetail` borrow caption / enablement
- Shared pure helper(s) if needed so MarketRowDetail and PositionList share one emptiness definition
- ConvertForm deposit fee approve amount + `convertApprovalNeeds` / tests
- Update `web/tests/e2e/borrow.feature` "no liquidity posted" scenario to assert the pre-gate
- Component tests for market-row disabled state

**Out of scope**

- Tickets 01–02 (E2E verify-only for claim-all / repay) — separate execute work
- Revisiting 2% vs MaxUint vs frozen quote (closed in ticket 04)
- Solidity / vault fee math
- Changing modal empty-ladder UX beyond keeping it as defense in depth
- PT approve buffering; wrap approve buffering

### Key Decisions

- KTD-P1. session-settled: ticket 03 — Fix by pre-gating market-row `BORROW`, not by leaving discovery to the modal. Rationale: prevents a real `APPROVE STREAM` signature for a borrow that cannot fill.
- KTD-P2. session-settled: ticket 03 — Caption text is `NO LIQUIDITY POSTED AT ANY RATE` (match modal), not the shorter stream-card `NO LIQUIDITY`.
- KTD-P3. session-settled: ticket 04 — Option B buffered approval at **2%** (`fee * 1.02`). Option A unlimited ruled out by ethskills security guidance cited in the ticket; option C frozen quote not chosen.
- KTD-P4. session-settled: ticket 04 — Buffer applies to deposit fee-token approve only.

### Outstanding Questions

None blocking. Deferred: whether a future plan should extract a shared `useMarketBorrowTeaser` hook for MarketRowDetail + PositionList (nice-to-have; KTD1 below prefers the smallest correct share).

---

## Planning Contract

### Key Technical Decisions

- KTD1. Share emptiness via the same helpers PositionList already uses: `useLending` (lending `aprMinBps`/`aprMaxBps`/`feeBps`), `useLendingLiquidity`, `aprChoices` (`web/lib/lending-math.ts`), `buildLadder` (`web/lib/router.ts`), `borrowTeaserBps` (`web/lib/positions.ts`) — empty when `teaserBps === null`. **Not** a new RPC shape. Prefer duplicating the small ladder→`teaserBps === null` expression in MarketRowDetail over a large PositionList refactor, unless a one-line exported helper (`hasPostableLiquidity(ladder)` or `marketHasBorrowLiquidity(...)`) clearly removes drift risk. Do not invent a third "empty" definition from raw position counts that ignores self-liquidity exclusion.
- KTD2. Caption priority in `borrowCaption`: keep `baseActionCaption` first, then `NO STREAMS AVAILABLE`, then **`NO LIQUIDITY POSTED AT ANY RATE` when lending+liquidity reads have settled and `teaserBps === null` (and lending exists, not matured)**. While `useLending` / `useLendingLiquidity` / held-streams are still loading, do **not** show the no-liquidity caption (treat as not-yet-known — keep button disabled without that caption, or defer to existing loading UX in the row). Only when streams exist and liquidity exists is caption `null` (button enabled).
- KTD3. Deposit fee buffer lives as a named pure helper in `web/lib/convert.ts` (e.g. `bufferedFeeApproveAmount(feeAmount)` → `feeAmount * 102n / 100n`) so ActionModal and tests share one formula. Integer math only; for `feeAmount === 0n` the approve branch is already gated off by `convertApprovalNeeds`.
- KTD4. `convertApprovalNeeds` continues to compare live `feeAmount` (unbuffered) against `underlyingAllowance` and `underlyingApprovedAmount`. The buffer is applied only when **constructing** the approve `args` and when **setting** `underlyingApprovedAmount` to the submitted approve amount — so a successful buffered approve naturally covers requotes up to that ceiling. Do not change `needsUnderlyingApproval` to compare against a second buffered live fee (would hide genuine under-approval).
- KTD5. Never approve `maxUint256` on this path — enforce via code review + an explicit regression test that the approve amount equals the buffered helper output for a known fee.
- KTD6. Ship as **two implementation units** in one plan (can be one PR or two commits). U1 (borrow gate) owns the e2e scenario rewrite; U2 (fee buffer) owns convert math. No shared file edits between units except possibly a tiny positions helper used only by U1.

### Technical Design

**U1 — Market-row liquidity gate**

1. In `MarketRowDetail`, when `market.lending` is set and not matured, call `useLending(market.lending)` + `useLendingLiquidity(market.lending)`, build ticks via `aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps)`, `buildLadder(..., user)`, compute `teaserBps = borrowTeaserBps(ladder, ttmSeconds, lending.params.feeBps)` (same as PositionList — do not invent params from `market.feeBps`, which is the vault deposit fee).
2. Extend `borrowCaption` null-coalesce chain with the no-liquidity caption when streams exist but `teaserBps === null`.
3. Add/extend component tests under `web/tests/components/` (prefer extending `markets-table.test.tsx` or a focused MarketRowDetail test if one exists; otherwise add assertions beside existing markets-table borrow disabled cases).
4. Rewrite `web/tests/e2e/borrow.feature` scenario "Error state — no liquidity posted for this market" to assert the market-row button is disabled with the caption — do not open the modal / click `APPROVE STREAM`. Keep modal empty-state coverage in unit tests (`borrow-form.test.tsx` already covers it).

**U2 — Fee approve buffer**

1. Add `bufferedFeeApproveAmount` (name flexible) in `web/lib/convert.ts`.
2. ConvertForm deposit branch: `approveAmount = bufferedFeeApproveAmount(feeAmount)`; `setUnderlyingApprovedAmount(approveAmount)`.
3. Extend `web/tests/lib/convert.test.ts` for AE3/AE4-style cases (allowance/optimistic approve vs live fee within/beyond buffer). Optionally a thin ActionModal/convert form test if the approve amount is only asserted via lib (lib coverage is sufficient if ActionModal only calls the helper).

### Assumptions

- `borrowTeaserBps` returning `null` is the canonical "no postable liquidity at any rate" signal (self-liquidity excluded via `buildLadder`). Verified against existing PositionList behavior.
- 2% is enough for block-to-block preview drift; larger market moves correctly require re-approve (R8).
- Tickets 01–02 remain out of this plan's verification scope.

### Risks

| Risk | Mitigation |
|------|------------|
| MarketRowDetail and PositionList diverge on emptiness | KTD1 — same pure helpers; optional one-liner `hasPostableLiquidity` |
| E2E still clicks enabled BORROW | Rewrite scenario in U1; fail CI if old steps remain |
| Buffer rounding for tiny fees | `* 102n / 100n`; add case `feeAmount = 1n` → at least `1n` after math (1*102/100 = 1) — if 1 wei fee needs headroom, document residual; optional `max(fee, fee*102/100)` is identity for integers |
| Caption locator collisions with StreamCard `NO LIQUIDITY` | Use full modal string on market-row only (KTD-P2) |
| Flash of `NO LIQUIDITY POSTED…` while liquidity is still loading | KTD2 — apply no-liquidity caption only after lending/liquidity reads settle |

### Sequencing

1. U1 (borrow gate + e2e rewrite)
2. U2 (fee buffer) — independent; can parallelize if desired

---

## Implementation Units

### U1. Pre-gate market-row BORROW on empty ladder

**Goal:** Borrowers cannot open BORROW / reach `APPROVE STREAM` when the market has no postable liquidity.

**Requirements:** R1–R5, F1–F2, AE1–AE2, KTD-P1, KTD-P2, KTD1, KTD2

**Files:**
- Modify: `web/components/MarketRowDetail.tsx`
- Optional modify: `web/lib/positions.ts` (tiny shared emptiness helper)
- Modify: `web/tests/e2e/borrow.feature`
- Modify or create: `web/tests/components/markets-table.test.tsx` (or dedicated MarketRowDetail test)
- Reference only: `web/components/PositionList.tsx`, `web/tests/components/position-cards.test.tsx`, `web/tests/components/borrow-form.test.tsx`

**Approach:** Wire `useLending` + `useLendingLiquidity` + existing ladder/teaser helpers into `borrowCaption` (same construction as PositionList). Update e2e to assert disabled market-row control. Leave modal empty-state as defense in depth.

**Test scenarios:**
- Connected + eligible stream + empty ladder (reads settled) → market-row `BORROW` disabled + `NO LIQUIDITY POSTED AT ANY RATE`
- Connected + eligible stream + non-self liquidity at a tick → `BORROW` enabled, no that caption
- While liquidity/lending still loading → do not assert `NO LIQUIDITY POSTED AT ANY RATE` yet
- Priority: `NO STREAMS AVAILABLE` wins over no-liquidity when no streams
- Priority: `CONNECT WALLET` / matured / lending-not-deployed still win via `baseActionCaption`
- E2E: "no liquidity posted" scenario no longer opens modal or clicks `APPROVE STREAM`
- Regression: stream card still shows `BORROW STREAM #{id}` + `NO LIQUIDITY` when empty

**Execution note:** Prefer test-first for the MarketRowDetail caption cases; update e2e scenario in the same unit before claiming done.

**Verify:** `npm --prefix web run test -- --run tests/components/markets-table.test.tsx tests/components/position-cards.test.tsx` (adjust paths to whatever files changed); e2e `borrow.feature` under `bootstrap:e2e` when running the full gate.

**Done when:** R1–R5 acceptance criteria on ticket 03 are checkable; e2e scenario rewritten; unit tests green.

### U2. Buffer deposit fee-token approve by 2%

**Goal:** Sub-2% fee requote drift does not strand deposit on a second underlying approve; unlimited approvals remain forbidden.

**Requirements:** R6–R10, F3–F4, AE3–AE4, KTD-P3, KTD-P4, KTD3–KTD5

**Files:**
- Modify: `web/lib/convert.ts`
- Modify: `web/components/ActionModal.tsx` (ConvertForm approve amount only)
- Modify: `web/tests/lib/convert.test.ts`

**Approach:** Pure buffered amount helper; deposit approve path uses it for both `writeContract` args and optimistic `underlyingApprovedAmount`. `convertApprovalNeeds` still gates on live unbuffered `feeAmount` vs allowance/optimistic approved amount.

**Test scenarios:**
- `bufferedFeeApproveAmount(100n) === 102n` (and a non-round fee case)
- Approve path never uses max-uint (assert helper output / approve args in unit test)
- After optimistic/on-chain approve of buffered amount, live fee within buffer → `needsUnderlyingApproval === false`
- Live fee beyond buffer → `needsUnderlyingApproval === true`
- Wrap mode still requires exact `amount` approval (unchanged behavior)
- `feeAmount === 0n` → still no underlying approve need on deposit

**Execution note:** Characterization tests on current exact-fee behavior first, then flip helper + ActionModal and extend assertions.

**Verify:** `npm --prefix web run test -- --run tests/lib/convert.test.ts`

**Done when:** Ticket 04 acceptance criteria checkable; no max-uint on fee path; tests green.

---

## Verification Contract

- Unit: `npm --prefix web run test` (full suite before merge)
- Focused during implementation: convert + markets/position component tests as listed per unit
- E2E (U1): with `MAINNET_RPC_URL` set, `npm --prefix web run bootstrap:e2e` then run `borrow.feature` (or full `test:e2e`); follow `docs/agents/testing.md` before declaring failures real
- Do not require tickets 01–02 claim-all/repay verifies for this plan's DoD

---

## Definition of Done

**Global**

- [ ] R1–R10 satisfied
- [ ] Ticket 03 and 04 acceptance checklists updated to checked (or comment with PR link) when work lands
- [ ] `npm --prefix web run test` green
- [ ] No unlimited ERC-20 approve introduced on the fee path
- [ ] Plan path linked from both tickets (this document)

**Per unit**

- [ ] U1: market-row gate + e2e rewrite + component coverage
- [ ] U2: buffered helper + ConvertForm wire-up + convert unit tests
