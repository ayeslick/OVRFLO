# 03 — Borrow: the blind fill

**What to build:** `borrow(market, aprBps, targetBorrow, streamId, minAcceptable)` per R9–R12: no position identifiers anywhere in calldata. Validate (`ZeroTarget`, market active, spacing set, stream eligibility via unchanged `StreamPricing.requireEligible` plus the `MIN_STREAM_AMOUNT` wrapper), floor target to UNIT, fill `min(flooredTarget, root − filled)` from the oldest live epoch only with the `MIN_LIQUIDITY_AMOUNT` fill floor, price the obligation via `obligationForFill`, enforce `minAcceptable`, consume with ONE `filled` SSTORE (carrying the packed `loanCount` increment), store the loan with frozen `{fillStart, fillEnd, seq, epoch}`, append `loanAt`, append the borrower's per-user loan index, escrow the stream NFT with plain `transferFrom`, pay borrower net of fee, emit `Borrowed` per pinned schema.

**Blocked by:** 02

**Status:** claimed
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/03-borrow-blind-fill.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Servicing/claims are 04; epoch rollover
activation is 05 (oldestLiveEpoch is 0 here).
Before any code, read Required reading below and the plan sections: Goal Capsule,
Product Contract (R5, R8–R12, R19; AE1, AE7), Planning Contract (KTD4, KTD9, KTD10,
KTD11; Risks #6, #9; Pinned Conventions and Schemas), and ### U3.
Sablier NFT escrow uses plain transferFrom — never safeTransferFrom. Every entrypoint
carries nonReentrant individually.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 6, 13, 18, 19)
- `docs/audit/sablier-interface-contract.md` (S1–S4, ACL table)
- `docs/audit/rejected-findings-record.md` (L-12 — self-match is deliberately not guarded; do not re-add)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Covers AE1. Two same-block borrowers targeting 12 each against 16 available: first gets 12, second gets 4 or a clean `BelowMinAcceptable` revert — no "inactive position" failure mode exists
- [x] Covers AE7. A borrower's own resting liquidity is consumable like any other; no self-match guard anywhere
- [x] Max borrow = sale: full-borrow obligation equals the stream's entire remaining (R11)
- [x] Fill mechanics: target floored to UNIT; fill ≥ `MIN_LIQUIDITY_AMOUNT` else `BelowMinimum`; single epoch only; consumption is exactly one `filled` SSTORE with `loanCount` packed in the same slot
- [x] Loan record stores `{borrower, streamId, market, aprBps, epoch, seq, fillStart, fillEnd, obligation}`; `loanAt[...][seq] = loanId` appended; borrower per-user index appended
- [x] Eligibility: `requireEligible` + `MIN_STREAM_AMOUNT` floor carried over; pledging a stream that already backs an open loan reverts naturally via ERC-721's owner check (lending owns the escrowed NFT) — asserted in a test, no bespoke error per user decision 2026-08-08; re-pledge of a returned stream is exercised once 04 lands (note the seam)
- [x] Errors: `ZeroTarget`, `EmptyTick` (incl. never-supplied tick — no low-level tree failure surfaces), `SpacingUnset`, `BelowMinAcceptable`, `BelowMinimum`
- [x] `Borrowed` event matches the pinned schema field-for-field; NFT owner after borrow is the lending contract; borrow at maturity block reverts, one block before succeeds
- [x] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U3 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
