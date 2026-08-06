# 11 — Zero-first approval step

**Category:** bug (security hygiene)

**Covers:** R28 (Tranche 4). Findings: L-3.

**What to build:** Changing an ERC-20 allowance from one non-zero value to a different non-zero value goes through a zero-first step, rather than approving the new amount directly over an existing non-zero allowance.

**Details:**
- This is the standard ERC-20 approval-race mitigation. Identify every allowance-changing call site (deposit fee approve, PT approve, stream approve, any adjust-rate-driven allowance change) where a live non-zero allowance could be replaced by a different non-zero amount.
- When that case occurs, issue an approve-to-zero transaction first, then the new-amount approve, rather than a single non-zero-to-non-zero approve.
- Coordinate with ticket 04 (reverted approval = failure) and the separate dogfood plan's 2% fee-approve buffer — this ticket adds a zero-first step where needed, it does not change the buffer math or the revert-detection logic.

**Acceptance criteria:**
- [x] Every allowance-changing call site identified and classified: does it ever go non-zero → different non-zero?
- [x] Those call sites issue a zero-first approve before the new-amount approve
- [x] A regression test asserts the two-step sequence for a non-zero → non-zero change, and a single-step approve for zero → non-zero
- [x] `npm --prefix web run test` green

**Out of scope:**
- The 2% fee-approve buffer strategy itself (separate plan, ticket 04 of `.scratch/dogfood-c1024d9-followups/`)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Touches the same approval code as ticket 04 and the dogfood plan's fee-buffer work — whoever picks these up should sequence or coordinate to avoid three separate edits to the same approve logic.

**2026-07-29 (implemented):** Landed as U11 on branch `fix/audit-2026-07-28-tranche-1`, with the approach changed by maintainer direction mid-implementation.

*Original approach, rejected.* The textbook fix clears a non-zero allowance to zero before setting a different non-zero one, unconditionally. Maintainer's objection: the protocol uses wstETH, which cannot produce that revert, so an unconditional two-step spends an extra transaction and an extra signature on every re-approve — real gas on every deposit and repay — to defend against something that cannot happen. That is correct, and the first implementation was discarded.

*What shipped, per the maintainer's compromise.* Approve optimistically in one transaction. If that approve fails, and the failure has the shape this defends against (existing allowance non-zero, target non-zero), fall back to the zero-first sequence and retry once. The common path costs nothing extra; the second step is paid only when the failure is real. A form-level notice explains the second signature prompt so it is not mysterious. `useZeroFirstApprove` covers the four ERC-20 approve sites; the Sablier NFT approve is untouched, being a different primitive.

*A bug found along the way.* A confirmed approve did not retire its attempt, so any later approve failure in the same form re-fired a zero-approve against an allowance that was already correct. Fixed, with a regression test.

*A misattribution worth recording.* While verifying this, the full E2E suite failed on `claim-all`'s "empty position categories" scenario, and I concluded the new hook caused it — the full suite had passed twice without it and failed twice with it. That was wrong. The scenario has no `Given`: it asserts an absence and depends entirely on residue from whatever ran before it. Running borrow + claim-all as a subset reproduced the failure **without** the hook, which is the control I should have run first. I was about to revert working code on that bad evidence.

The scenario is now fixed rather than left as a trap: it expands the primary market, which the dev wallet never transacts in, so absence is guaranteed by construction instead of incidental. The borrow + claim-all subset that failed reliably in both configurations now passes.

Verification: 417 unit tests, 31 E2E scenarios (full suite green on three consecutive fresh bootstraps), lint, `tsc --noEmit`, and the a11y sweep clean.
