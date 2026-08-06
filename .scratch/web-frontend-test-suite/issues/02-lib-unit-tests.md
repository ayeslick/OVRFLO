# 02 — Lib unit tests: expand and complete

**What to build:** Expand the 12 existing `web/lib/` test files with edge cases, and add 3 new test files for the currently-untested lib modules.

**Blocked by:** None for writing the tests themselves (existing `vitest`/`vi.mock` infra already supports this). The coverage-*number* half of Verification needs Ticket 01's `@vitest/coverage-v8` setup first — don't expect a coverage figure until then, but don't wait to start writing tests.

**Status:** done

- [x] Edge cases (zero values, max uint values, empty strings, boundary conditions at decimal display thresholds) added to: `format.test.ts`, `lending-math.test.ts`, `modal-logic.test.ts`, `errors.test.ts`, `abis.test.ts`, `convert.test.ts`, `borrow.test.ts`, `claim-all.test.ts`, `demand.test.ts`, `invalidate.test.ts`, `positions.test.ts`, `router.test.ts`
- [x] New `web/tests/lib/config.test.ts`: env parsing, chain id enforcement, `isConfiguredAddress`
- [x] New `web/tests/lib/query-keys.test.ts`: key uniqueness
- [x] New `web/tests/lib/ponder.test.ts`: client creation, null base URL handling
- [x] `npm --prefix web run test` passes
- [x] Coverage for `web/lib/` visibly improves over the pre-ticket baseline (once Ticket 01 lands) — `web/lib/` now at 100% statements/functions/lines, 97.76% branches

See plan Unit U2 (R4, R5) in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

Spec review ([Spec compliance review of ticket 02](c36479cb-8aaf-4c73-86fc-2b6270f326c2)): PASS, no findings.

Standards review ([Standards review of ticket 02 tests](c44dc667-a288-45b8-806d-dd8902fe4419)): 28 findings (2 must-fix, 17 should-fix, 9 nits). All addressed except two cosmetic "extract a shared helper" nits (an `upperAddress()` test helper and a `revertedWith()` mock factory), left as-is since they're pure refactors with no correctness value and the duplication is small (3-4 call sites). Fixes applied:

- **`ponder.test.ts`** (the two must-fixes): `createPonderClient`/`fetchHeldStreamIds`/`fetchBorrowDemand` default `baseUrl` to the ambient `ponderUrl` from `lib/config`, so passing explicit `undefined` was silently testing ambient config, not "unconfigured" — fixed by mocking `@/lib/config` to pin `ponderUrl: undefined`. Also added `beforeEach(vi.clearAllMocks)` (one assertion could never fail without it) and switched to `vi.hoisted` + top-of-file imports. Added the two missing happy-path row-mapping tests (`fetchHeldStreamIds`/`fetchBorrowDemand` field mapping, address normalization, cutoff computation) that were the file's real coverage gap.
- **`config.test.ts`**: removed the static top-of-file import (it evaluated `lib/config.ts` against the real ambient env at file-collection time, before any `vi.stubEnv` — reproducibly collapsed the whole file to 0 tests under a hostile `NEXT_PUBLIC_CHAIN_ID`); added a file-wide `beforeEach` stubbing all 6 read env vars to unset so no test depends on ambient contamination; added the empty-string chain-id, malformed-RPC-URL, and empty-string-reownProjectId cases the ticket's own edge-case scope implied but didn't cover.
- **`lending-math.test.ts`**: deleted a tautological `MAX_UINT128 + 1n === 1n << 128n` assertion (restates the source formula); fixed a test name that mischaracterized `MAX_UINT128` as a Sablier `withdrawMax` sentinel (it's actually `claimLoanPoolShare`'s max-amount sentinel); strengthened the vacuous all-zero `loanOutstanding` case with the `isLoanOpen` assertion it was actually trying to make.
- **`abis.test.ts`**: simplified the TS2367 workaround (one `.map` widening instead of an `as string` cast per compare); dropped an unnecessary `as string[]` cast; replaced the order-dependent, type-blind `erc20Abi` name-list assertion with a comparison against viem's own `erc20Abi` for mutability + parameter/return types (sorted names, so cosmetic reordering doesn't fail it).
- **`format.test.ts`**: replaced an `as never` cast with the correct `as Address`.
- **`router.test.ts`**: fixed a "no self connected" test that used the default lender (irrelevant either way) — now uses a position lent by `self` with `self` omitted from the call, so the assertion depends on the omission actually being honored.
- **`positions.test.ts`**: added a lender-case-insensitivity test using an address with real hex letters (the existing one used an all-digit address, so `.toLowerCase()` was a no-op that never exercised normalization).
- **`borrow.test.ts`**: renamed a misleadingly-named "nets to zero" test (net actually equals the full contributed amount) and added a `feeBps: 1` case that pins floor-not-round fee division; renamed a "empty-message" test that also covered `undefined`; folded a redundant slippage-rejection case into its sibling `it`.
- **`errors.test.ts`**: sorted the `eligibilityErrorNames` golden-vector comparison (was order-dependent on `Object.keys` insertion order); replaced `STALE_LIQUIDITY_REASONS`'s "not the generic fallback" check with an exact per-reason expected-copy table; merged a near-duplicate empty-string fallback test into its sibling.
- **Nits**: trimmed duplicate boundary assertions in `demand.test.ts`, replaced a vacuous zero-amount slippage test with a floor-vs-round-observable case in `modal-logic.test.ts`, deleted a self-referential tautology (`toEqual` on the same call twice) in `query-keys.test.ts`.

Full suite after fixes: 37 files / 293 tests passed. `npx tsc --noEmit` and `npx eslint` clean.
