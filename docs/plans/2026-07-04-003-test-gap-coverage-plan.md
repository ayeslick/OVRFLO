---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "test: close untested branches and process holes"
date: 2026-07-04
type: test
---

## Goal Capsule

Close 19 untested branch arms (3 guarding critical patterns #5, #8, #13) and 2 process gaps (fork self-skip, fizz operational note). No `src/` changes — all items add tests or test infrastructure only.

**Authority hierarchy:** lcov branch coverage report is the source. Revert-string audit (`grep -ohE '"OVRFLO(Book|Factory)?: [^"]*"' src/*.sol | sort -u`) confirms each guard is exercised at least once under `test/`. Critical patterns in `docs/solutions/patterns/ovrflo-critical-patterns.md` guide.

**Stop conditions:** All 8 items implemented, `forge test` passes (unit + fuzz + invariant + attack), `forge coverage` shows only documented defensive branches remaining at zero hits.

## Product Contract

### Requirements

- **R1:** `sweepExcessPt` unknown-PT guard (pattern #13) is tested — revert on non-PT token, balance unchanged after revert.
- **R2:** `prepareOracle` upper bound (pattern #5) is tested — revert when TWAP duration exceeds `MAX_TWAP_DURATION`.
- **R3:** `_pullExact` transfer mismatch is tested on the book — `postOffer` with a short-transfer ERC20 reverts.
- **R4:** `createBorrowPool` boundary reverts are tested — borrow zero, empty offers, price zero, borrow above price, later offer inactive.
- **R5:** Pool claim and repay edge reverts are tested — nothing claimable, claim zero, nothing outstanding.
- **R6:** `quote()` has unit test coverage — full borrow, partial borrow, borrow above price, APR out of bounds.
- **R7:** View sentinels and idempotent cancels are tested — unknown offer/listing IDs, cancel-twice reverts.
- **R8:** `StreamPricing` WrongEndTime overflow arm is tested.
- **R9:** Oracle-state asymmetry is locked — deposit and flashLoan succeed when `increaseCardinalityRequired=true` but `oldestObservationSatisfied=true`.
- **R10:** Fork tests self-skip without `MAINNET_RPC_URL` instead of failing.

## Planning Contract

### Key Technical Decisions

**KTD-1: Defensive branches via harness or documentation.** Two zero-hit branches (`loan not in pool`, `uint128 overflow`) are unreachable from the external ABI. Add a tiny `BookInternalHarness` for `_toUint128` (one-line wrapper, one test). Document `loan not in pool` as defensive in a comment. If the harness feels like overkill during implementation, documenting both as defensive is acceptable — the goal is that the branch report is explainable, not that it reads 100%.

**KTD-2: Short-transfer mock for `_pullExact` test.** Add a local `ShortTransferERC20 is TestERC20` in `test/OVRFLOBook.t.sol` that transfers `amount - 1`, mirroring `ShortTransferUnderlying` in `test/OVRFLOWrapUnwrap.t.sol`. Deploy a second book with the short token as `underlying` to trigger the mismatch.

**KTD-3: Fizz properties are operational, not code.** `FoundryTester.test_sequence()` is empty — fizz coverage is Echidna/Medusa only. No test-code change; flag for release checklist inclusion.

### Assumptions

- 100% line coverage is already achieved; this plan targets branch coverage only.
- The mock dedup refactor (commit `1997abb`) is the baseline — shared mocks in `test/mocks/` are available.
- `MAX_TWAP_DURATION` is a public getter on `OVRFLOFactory`.

## Implementation Units

### U1. High-priority guard tests (Items 1a, 1b, 1c)

**Goal:** Test the three critical-pattern guards that are currently untested.

**Requirements:** R1, R2, R3

**Files:**
- `test/OVRFLO.t.sol` — add `test_SweepExcessPt_RevertsForUnknownPt`
- `test/OVRFLOFactory.t.sol` — add `test_PrepareOracle_RevertsWhenTwapTooLong`
- `test/OVRFLOBook.t.sol` — add `ShortTransferERC20` mock, add `test_PostOffer_RevertsOnTransferMismatch`

**Approach:**
- 1a: Fund vault with underlying, call `sweepExcessPt(address(underlying), TREASURY)`, expect `"OVRFLO: unknown PT"`. Assert balance unchanged.
- 1b: Call `factory.prepareOracle(market, factory.MAX_TWAP_DURATION() + 1)`, expect `"OVRFLOFactory: twap too long"`.
- 1c: Deploy `ShortTransferERC20 is TestERC20` (overrides `transfer` to send `amount - 1`). Deploy a second book with the short token as `underlying`. Call `postOffer`, expect `"OVRFLOBook: transfer mismatch"`.

**Test scenarios:**
- **Happy path (1a):** Non-PT token passed to `sweepExcessPt` reverts, balance unchanged
- **Happy path (1b):** TWAP duration exceeding max reverts with correct error
- **Happy path (1c):** Short-transfer ERC20 triggers mismatch revert on `postOffer`
- **Edge case (1a):** Unapproved PT-like token also reverts

**Verification:** `forge test --match-test "SweepExcessPt_RevertsForUnknownPt|PrepareOracle_RevertsWhenTwapTooLong|PostOffer_RevertsOnTransferMismatch"` passes.

---

### U2. createBorrowPool boundary reverts (Item 2)

**Goal:** Test all input-validation reverts in `createBorrowPool`.

**Requirements:** R4

**Files:**
- `test/OVRFLOBook.t.sol` — add 5 test functions

**Approach:**
- `test_CreateBorrowPool_RevertsWhenBorrowZero`: `targetBorrow = 0` → `"OVRFLOBook: borrow zero"`
- `test_CreateBorrowPool_RevertsWhenOffersEmpty`: `offerIds = new uint256[](0)` → `"OVRFLOBook: empty offers"`
- `test_CreateBorrowPool_RevertsWhenPriceZero`: stream with `deposited = 1 wei` (grossPrice floors to 0) → `"OVRFLOBook: price zero"`
- `test_CreateBorrowPool_RevertsWhenBorrowAbovePrice`: offer capacity and `targetBorrow` both above grossPrice → `"OVRFLOBook: borrow above price"`
- `test_CreateBorrowPool_RevertsWhenLaterOfferInactive`: two offers, cancel second, pass `[id1, id2]` → `"OVRFLOBook: offer inactive"` from `_validateOffers` loop

**Test scenarios:**
- **Error path:** Each of the 5 revert conditions triggers with the exact expected error string
- **Edge case (later offer inactive):** The first offer is active — tests the loop body, not the pre-loop check

**Verification:** `forge test --match-test "CreateBorrowPool_RevertsWhen"` passes (5 tests).

---

### U3. Pool claim and repay edge reverts (Item 3)

**Goal:** Test the remaining untested revert paths in pool claim and loan repayment.

**Requirements:** R5

**Files:**
- `test/OVRFLOBook.t.sol` — add 3 test functions

**Approach:**
- `test_PoolClaimLoan_RevertsWhenNothingClaimable`: valid pool, `withdrawable = 0` → `"OVRFLOBook: nothing claimable"`
- `test_ClaimPoolShare_RevertsWhenClaimZero`: proceeds available, `amount = 0` → `"OVRFLOBook: claim zero"`
- `test_RepayLoan_RevertsWhenNothingOutstanding`: contributor drains full obligation via `poolClaimLoan`, then `repayLoan` → `"OVRFLOBook: nothing outstanding"`. Follow with `closeLoan` and assert stream returns to borrower.

**Test scenarios:**
- **Error path:** Each revert triggers with exact expected error string
- **Integration (nothing outstanding):** `closeLoan` after failed `repayLoan` still returns the stream NFT

**Verification:** `forge test --match-test "PoolClaimLoan_RevertsWhenNothingClaimable|ClaimPoolShare_RevertsWhenClaimZero|RepayLoan_RevertsWhenNothingOutstanding"` passes.

---

### U4. quote() unit tests (Item 4)

**Goal:** Add unit test coverage for `quote()` — currently only covered by fork and invariant handlers.

**Requirements:** R6

**Files:**
- `test/OVRFLOBook.t.sol` — add 4 test functions

**Approach:**
- `test_Quote_FullBorrowMatchesCreateBorrowPool`: `borrowAmount = 0` returns `obligation == remaining`. Compare values with an actual `createBorrowPool` fill at the same params.
- `test_Quote_PartialBorrow`: `0 < borrowAmount < grossPrice` — obligation ceil-rounded, `residual == remaining - obligation`, fee/net math correct.
- `test_Quote_RevertsWhenBorrowAbovePrice`: `borrowAmount > grossPrice` → `"OVRFLOBook: borrow above price"`.
- `test_Quote_RevertsWhenAprOutOfBounds`: `aprBps = 500` (outside default [1000, 1000] bounds) → `"OVRFLOBook: apr out of bounds"`.

**Test scenarios:**
- **Happy path:** Full borrow and partial borrow return correct values
- **Error path:** Borrow above price and APR out of bounds revert correctly
- **Integration:** Full-borrow quote values match actual settlement

**Verification:** `forge test --match-test "Quote_FullBorrow|Quote_PartialBorrow|Quote_RevertsWhen"` passes.

---

### U5. View sentinels and idempotent cancels (Item 5)

**Goal:** Test view-function unknown-ID reverts and double-cancel reverts.

**Requirements:** R7

**Files:**
- `test/OVRFLOBook.t.sol` — add 4 test functions

**Approach:**
- `test_OfferState_RevertsForUnknownId` → `"OVRFLOBook: unknown offer"`
- `test_SaleListingState_RevertsForUnknownId` → `"OVRFLOBook: unknown listing"` (completes pattern #8)
- `test_CancelOffer_RevertsWhenAlreadyCancelled` (cancel twice) → `"OVRFLOBook: offer inactive"`
- `test_CancelSaleListing_RevertsWhenAlreadyCancelled` → `"OVRFLOBook: listing inactive"`

**Test scenarios:**
- **Error path:** Each unknown-ID and double-cancel revert triggers with exact expected error string

**Verification:** `forge test --match-test "OfferState_RevertsForUnknown|SaleListingState_RevertsForUnknown|CancelOffer_RevertsWhenAlready|CancelSaleListing_RevertsWhenAlready"` passes.

---

### U6. StreamPricing WrongEndTime + oracle asymmetry (Items 6, 7)

**Goal:** Test the WrongEndTime overflow arm and lock the oracle-state asymmetry.

**Requirements:** R8, R9

**Files:**
- `test/StreamPricing.t.sol` — add WrongEndTime test
- `test/OVRFLO.t.sol` — add oracle asymmetry test for `deposit`
- `test/OVRFLOFlashLoan.t.sol` — add oracle asymmetry test for `flashLoan`

**Approach:**
- Item 6: Use 7-arg `setSeries` to set `expiryCached = uint256(type(uint40).max) + 1`, expect `WrongEndTime` from `requireEligible`.
- Item 7: Mock `getOracleState` as `(true, 42, true)` — `increaseCardinalityRequired=true` but `oldestObservationSatisfied=true`. Assert `deposit` and `flashLoan` succeed. Add comment documenting the intended asymmetry.

**Test scenarios:**
- **Error path (WrongEndTime):** Overflow expiry triggers `WrongEndTime` revert
- **Happy path (oracle asymmetry):** Deposit and flashLoan succeed with cardinality-required=true (vault checks only `oldestObservationSatisfied`)

**Verification:** `forge test --match-test "WrongEndTime|OracleAsymmetry"` passes.

---

### U7. Defensive branches and fork self-skip (Items 8a, defensive)

**Goal:** Document or cover the two defensive-only branches, and fix fork test self-skip.

**Requirements:** R10

**Files:**
- `test/OVRFLOBook.t.sol` — optionally add `BookInternalHarness` for `_toUint128`, document `loan not in pool` as defensive
- `test/fork/OVRFLOForkBase.t.sol` — change `vm.envString` to `vm.envOr` + `vm.skip`

**Approach:**
- 8a: Replace `vm.envString("MAINNET_RPC_URL")` with `vm.envOr("MAINNET_RPC_URL", string(""))` + `vm.skip(bytes(rpc).length == 0)` so fork tests skip gracefully when no RPC is configured.
- Defensive: Add `BookInternalHarness` with a one-line `_toUint128` wrapper if practical. Add a comment documenting `loan not in pool` as defensive-only. If the harness is overkill, document both as defensive.

**Test scenarios:**
- **Process (8a):** `forge test` without `MAINNET_RPC_URL` skips fork tests instead of failing
- **Process (8a):** `forge test --match-path "test/fork/*"` with `MAINNET_RPC_URL` set still runs fork tests

**Verification:** `forge test` without `MAINNET_RPC_URL` completes without fork-test failures. `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` still passes.

---

### U8. Coverage verification and revert-string audit

**Goal:** Confirm all branch gaps are closed and every revert string in `src/` is exercised.

**Requirements:** R1-R10

**Files:**
- No file changes — verification only

**Approach:**
1. Run `forge coverage --no-match-path "test/fork/*" --report lcov`
2. Confirm only documented defensive branches remain at zero hits
3. Run `grep -ohE '"OVRFLO(Book|Factory)?: [^"]*"' src/*.sol | sort -u` and verify each string appears at least once under `test/`

**Verification:** Coverage report shows ≤2 zero-hit branches (defensive-only). Revert-string audit is clean.

## Verification Contract

```bash
# Build
forge build

# Unit + fuzz + invariant + attack
forge test

# Fork tests (with RPC)
MAINNET_RPC_URL=$RPC forge test --match-path "test/fork/*"

# Coverage
forge coverage --no-match-path "test/fork/*" --report lcov

# Revert-string audit
grep -ohE '"OVRFLO(Book|Factory)?: [^"]*"' src/*.sol | sort -u
```

**Quality gates:**
- `forge build` — zero errors
- All test suites pass (unit, fuzz, invariant, attack, fork)
- `forge coverage` — only documented defensive branches at zero hits
- Revert-string audit — every `src/` revert string appears at least once under `test/`

## Definition of Done

- [ ] U1: sweepExcessPt unknown-PT, prepareOracle twap-too-long, _pullExact mismatch tests pass
- [ ] U2: 5 createBorrowPool boundary revert tests pass
- [ ] U3: 3 pool claim/repay edge revert tests pass
- [ ] U4: 4 quote() unit tests pass
- [ ] U5: 4 view sentinel and idempotent cancel tests pass
- [ ] U6: WrongEndTime overflow + oracle asymmetry tests pass
- [ ] U7: Fork tests self-skip without MAINNET_RPC_URL; defensive branches documented
- [ ] U8: Coverage report confirms gaps closed; revert-string audit clean
- [ ] `forge build` clean, `forge fmt` clean
