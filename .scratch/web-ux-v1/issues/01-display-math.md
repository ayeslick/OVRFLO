# 01 — Display math for outcome-first pricing

**What to build:** Client-side pure functions that mirror the lending contract's linear-discount pricing exactly, so every ladder row, teaser, and rate display can show "upfront %" and "fixed return %" without a network round-trip — while every number a transaction actually submits still comes from the contract's own `quote()` read. Includes the two-decimal-precision split (APR rates render two decimals, upfront/return percentages render one decimal).

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Golden-vector test matches the contract's `factor`/`grossPrice`/obligation math (see plan Unit U1 in `docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md` for the exact vectors, contract line refs, and rounding convention — floor/truncate, never round)
- [x] A cross-check invariant test ties the display math back to a real `quote()`-shaped calculation, with and without a nonzero protocol fee
- [x] One decimal for upfront/lender-return percentages; two decimals for APR rates — two distinct formatters, both covered by tests
- [x] No `Number(` conversions on token amounts anywhere in the new code (repo's banned-patterns lint enforces this)
- [x] `npm --prefix web run test` and lint both green

## Comments

**2026-07-27 (agent):** Resolved in commit b236024. Added `WAD`/`BPS`/`YEAR_SECONDS`, `factorWad`, `upfrontBps`, `lenderReturnBps`, `formatBpsPct` to `web/lib/lending-math.ts` per KTD2, TDD-first. Golden vector, cross-check invariant (fee 0 and 40 bps), ttm=0, and truncation tests all green (43/43 suite). `formatAprBps` (two decimals) untouched; banned-patterns and eslint clean. Pre-existing tsc errors in `web/tests/lib/abis.test.ts` are unrelated to this ticket.
