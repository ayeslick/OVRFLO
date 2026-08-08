# 04 — Servicing and claims: repay, close, claim, contributionOf

**What to build:** Loan servicing on lazy attribution. `contributionOf(loanId, positionId)` = overlap of the position's current interval (prefix query) with the loan's frozen interval, requiring identical `(market, aprBps, epoch)`. `claim(loanId, positionId, amount)`: lender-only, pattern-#12 recovered formula (`drawn + repaid + min(withdrawable, outstanding)` while open; `drawn + repaid` once closed), per-(loan, position) payout caps via `received`, JIT deficit harvest from the escrowed stream, `type(uint128).max` = claim everything. `repay` at face with overpayment rejected; permissionless `close` once withdrawable covers outstanding; stream returns via plain `transferFrom`; proceeds pot mirrors today's flow.

**Blocked by:** 03

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/04-servicing-and-claims.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. loansOf and epoch activation are 05.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Product Contract (R13–R16; AE3, AE4, AE5, AE9), Planning Contract (KTD7, KTD9;
Risks #3, #5, #6, #7; Pinned Conventions and Schemas), and ### U4.
The recovered/claim math carries the current _claimFair semantics (pre-rewrite
src/OVRFLOLending.sol:642–681 — read it from git history since 02 deleted it).
repay/close/claim are never gated by market state (KTD7).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 12, 13, 14, 15)
- `docs/solutions/architecture-patterns/cumulative-recovered-pro-rata-pool-claims.md`
- `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md`
- `docs/audit/sablier-interface-contract.md` (S2, S4 — harvest authority)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Covers AE3. Positions A(10)/B(6)/C(4), loan 1 consumes 12, B withdraws unfilled 4, loan 2 consumes 4: contributions compute A=10/B=2 to loan 1, C=4 to loan 2 — nothing stored at fill time
- [x] Covers AE4. Mid-term claim pays up to share × (drawn + repaid + withdrawable), harvesting the deficit from the stream in the same transaction
- [x] Covers AE5. Repay of full outstanding at face closes the loan and returns the stream; `RepayExceedsOutstanding` on overpayment; repay works before and after maturity
- [x] Covers AE9. Zero-overlap claim reverts `NoOverlap`; cross-`(market, aprBps, epoch)` claim reverts `EpochMismatch` — adversarial test pairs two epochs with numerically identical intervals and proves the epoch check (not coincidence) blocks it (risk #3)
- [x] Harvest polarity regression (pattern #13, risk #7): the deficit harvest fires if and only if the loan is open; claim after close uses `drawn + repaid` only
- [x] Order-independence: any claim order across contributors yields identical totals; Σ payouts per closed loan = recovered minus dust; dust is lender-unfavorable, strands in the contract, bounded by contributor count (risk #5)
- [x] GL-70 seam at unit level: a returned stream re-pledged to a new loan keeps the two loans' draw accounting isolated
- [x] `close` is permissionless, requires coverage, reverts on second call (`LoanClosed`); stream returns via plain `transferFrom` (risk #6); fee touched only the borrow leg — recovered/claims are fee-free
- [x] Events `Repaid`/`Closed`/`Claimed` match the pinned schema (absolute values); `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U4 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
