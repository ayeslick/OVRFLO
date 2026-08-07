# 02 — Storage rewrite, lender lifecycle, tick-spacing plumbing

**What to build:** Gut `src/OVRFLOLending.sol`: delete sale paths (`sellStreamToLiquidity`, `postSaleListing`, `cancelSaleListing`, `buyListing`), the `LiquidityPosition`/`SaleListing`/`LoanPool` structs, listing storage/events, and eager-attribution mappings. Build the new skeleton: per-(market, aprBps) tick storage over TickTree (epoch machinery present but inert at epoch 0), `UNIT`/`MIN_LIQUIDITY_AMOUNT` constants, `supply`/`withdraw` per R6/R7, per-user position indexes, and the set-once `setLendingTickSpacing` factory forwarder. Custom errors throughout; keep `Ownable2Step, ReentrancyGuard, Multicall`.

**Blocked by:** 01

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/02-storage-lender-lifecycle.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Epochs stay inert at epoch 0 (05 activates
rollover); borrow/servicing do not exist yet (03/04).
Before any code, read Required reading below and the plan sections: Goal Capsule,
Product Contract (R1, R2, R6, R7, R18, R20; AE2), Planning Contract (KTD1, KTD3, KTD5,
KTD6, KTD7, KTD8, KTD10; Pinned Conventions and Schemas — constants, types, error
catalog, event schema are binding), and ### U2.
Reuse the mock fixture wiring in test/mocks/LendingMocks.sol and the
LendingInternalHarness exposure pattern when rewriting test/OVRFLOLending.t.sol.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 7, 8, 17 — and note #4/#10/#16 are superseded by this plan)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Sale-path functions, structs, mappings, and events are deleted; grep for `postSaleListing|buyListing|SaleListing|LoanPool|loanPoolContributions` over `src/` is clean
- [x] `supply`: `marketActive`-gated, spacing-set-gated, exact-UNIT and `MIN_LIQUIDITY_AMOUNT` enforced, appends leaf, creates position `{lender, market, aprBps, epoch, leafIndex}` (no amount field), appends per-user index, emits `Supplied` per pinned schema
- [x] `withdraw`: lender-only (`NotLender`), never market-gated, refunds exactly the unfilled portion via prefix query, shrinks leaf to filled history, emits `Withdrawn` with absolute `remainingLeaf` (AE2 first half; double withdraw reverts)
- [x] `setLendingTickSpacing`: three-line forwarder shape + factory re-emit; set-once (second call reverts), `ZeroSpacing` reverts, unknown-lending reverts; supply before spacing set reverts `SpacingUnset`
- [x] Ticks reject non-spacing-multiples and out-of-bounds APRs (`InvalidTick`); bounds read at call time
- [x] Per-user index: `lenderPositionCount`/`lenderPositionAt` enumerate exactly the created positions
- [x] All new errors are custom errors with the catalog's exact names; no require-strings in new code
- [x] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U2 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
