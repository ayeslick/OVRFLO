# 02 — Borrow router + claim-all planner

**What to build:** Two pure, fully unit-tested planners with no UI attached yet:
1. A router that, given the market's available liquidity and a borrow target, picks which liquidity to draw from — preferring a single position that fully covers the amount, otherwise accumulating oldest-first, and falling back to a partial-fill plan when nothing covers.
2. A claim-all planner that, given a user's claimable pools and streams, produces an ordered list of transactions (pool claims batched per contract, then individual stream claims) for the claim-all queue (Ticket 05) to execute.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Router: single covering position wins over accumulating multiple, even when a smaller-id position doesn't cover on its own
- [x] Router: no single position covers → oldest-id-first accumulation until covered
- [x] Router: lowest tick under-covers but a higher tick fully covers → correctly reports both the full option and the partial fallback
- [x] Router: nothing covers anywhere → reports a partial plan only, no phantom alternative
- [x] Router: the caller's own liquidity is always excluded from what it draws against
- [x] Router: output liquidity ids are always strictly increasing (the contract requires this and reverts otherwise)
- [x] Claim-all planner: pools across multiple lending contracts group into separate batched entries; zero-claimable pools are excluded; streams are ordered after pools
- [x] Full branch coverage in the unit test suite (see plan Unit U2 in `docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md` for the complete scenario list)

## Comments

**2026-07-27 (agent):** Resolved in commit d263d3e. New `web/lib/router.ts` (`buildLadder`, `planBorrow`) and `web/lib/claim-all.ts` (`planClaimAll`) per KTD3/KTD4, TDD-first; 17 unit tests cover every U2 branch scenario. Deviation from KTD3's two-arg `planBorrow` signature: a required third `self: Address | undefined` param — needed to filter self-owned ids from output (TickDepth.positions deliberately keeps self entries for UI), made required rather than optional after review flagged the silent-footgun risk. Full suite 57/57, eslint + banned-patterns clean.
