---
title: Adversarial Test Suite - Plan
type: test
date: 2026-06-27
topic: adversarial-test-suite
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Adversarial Test Suite - Plan

## Goal Capsule

- **Objective:** Add invariant, fuzz, and attack-scenario tests across all OVRFLO protocol surfaces to achieve pre-deployment confidence that no exploitable accounting drift, reentrancy path, or math edge case exists.
- **Product authority:** User confirmed scope covers flash loan, Book, deposit/claim, and oracle integration with all three testing strategies.
- **Open blockers:** None. Scope confirmed.
- **Execution profile:** Test-only changes (no production contract modifications).
- **Stop conditions:** All invariant tests pass at 500 runs, all fuzz tests pass at 256 runs, all attack scenarios pass, full suite green with fork tests.
- **Tail ownership:** Implementer owns cleanup of any experimental handler code that doesn't land in final test files.

## Product Contract

### Summary

A comprehensive adversarial test suite using invariant tests (handler-based property tests), fuzz tests (randomized function inputs), and attack scenario tests (multi-step integration tests) to stress-test all four protocol surfaces: flash loan, Book, deposit/claim accounting, and oracle integration.

### Problem Frame

The current test suite has 239 tests with 100% line coverage and 94% branch coverage, but coverage measures code path execution, not exploit resistance. Only 3 invariant tests exist (wrap/unwrap only), and only 10 fuzz tests exist (9 in StreamPricing.math.t.sol, 1 in StreamPricing.t.sol), all covering StreamPricing bounds. No property tests verify that flash loans can't drain the vault, that deposit/claim accounting is self-consistent under random operation sequences, or that Book loan accounting holds under adversarial conditions. Pre-deployment confidence requires proving invariants hold under random sequences of operations, not just that each function works in isolation.

### Requirements

**Invariant tests (handler-based property tests)**

- R1. Vault accounting invariant: ovrfloToken total supply equals sum of all marketTotalDeposited plus wrappedUnderlying, after any sequence of deposit, claim, wrap, unwrap, and flash loan operations.
- R2. PT backing invariant: vault's PT balance for each market is always >= marketTotalDeposited for that market, after any sequence of operations including flash loans.
- R3. Underlying reserve invariant: vault's underlying balance is always >= wrappedUnderlying, after any sequence of wrap, unwrap, and flash loan (fee) operations.
- R4. Flash loan non-drain invariant: flash loan never reduces vault PT balance or marketTotalDeposited; PT is always returned and fee goes to treasury.
- R5. Flash loan nonReentrant invariant: nested flash loans are always blocked, but deposit, wrap, and unwrap during callback always succeed.
- R6. Book obligation invariant: loan obligation never exceeds stream remaining face value at origination.
- R7. Book lender bounds invariant: lender's total received (claims plus close-loan payouts) never exceeds loan obligation.
- R8. Book NFT return invariant: stream NFT is always returned to the borrower when a loan is closed (by closeLoan, or by repayLoan with amount == outstanding). Claim-exhaustion alone does NOT return the NFT; a subsequent closeLoan is required.
- R9. Book solvency invariant: book contract's underlying balance always equals the sum of active sale offer capacities plus active lend offer capacities (escrowed liquidity). After settlement-only calls (sellIntoOffer, buyListing, borrowAgainstOffer, lendAgainstListing, claimLoan, closeLoan, repayLoan), no stray underlying remains.

**Fuzz tests (randomized inputs)**

- R10. Deposit split invariant: for any rate < 1e18 and amount >= MIN_PT_AMOUNT, toUser + toStream == ptAmount. At rate >= 1e18, toUser is capped at ptAmount and deposit reverts with "nothing to stream".
- R11. Flash loan fee correctness: for any amount, oracle rate, and feeBps, the fee matches `amount * rate / 1e18 * feeBps / 10000`.
- R12. StreamPricing bounds: for any remaining, aprBps, and timeToMaturity, grossPrice <= remaining and obligation <= remaining.
- R13. Dust amounts: flash loan, wrap, and unwrap with amounts as small as 1 wei do not revert and produce correct accounting. Deposit has a MIN_PT_AMOUNT = 1e6 floor, so dust deposit tests bound amount to [1e6, ...] and assert no revert + correct accounting at the minimum valid dust of 1e6.
- R14. Oracle edge rates: deposit and flash loan handle rate = 0 (zero toUser, full stream), rate at par (toStream = 0 reverts), and rate >= 1e18 (toUser capped at ptAmount, toStream = 0, reverts with "nothing to stream") without arithmetic errors. Flash loan fee scales linearly with rate and does not overflow.

**Attack scenario tests (multi-step integration)**

- R15. Full OVRFLO cycle: flash loan PT, deposit into vault, unwrap ovrfloToken for underlying, repay flash loan with separately acquired PT, verify all state is consistent.
- R16. Oracle manipulation during callback: flash loan callback changes oracle mock rate, attempts re-deposit at manipulated rate, verify fee calculation uses original rate (not callback rate).
- R17. Stream withdrawal during active loan: lender claims partial stream, borrower repays, closeLoan returns NFT, verify accounting across all steps.
- R18. Multi-market cross-contamination: deposit on market A, flash loan market B's PT (same underlying), verify operations are independent and no accounting crosses markets.
- R19. Reentrancy via callback then claim: flash loan callback deposits, attempts claim during callback (no warp), verify claim reverts with "OVRFLO: not matured" because block.timestamp < expiry (flash loan requires pre-maturity).

**Deferred**

- R20. Fee-on-transfer token edge case: deferred because the protocol is Pendle-specific and PT tokens do not charge transfer fees. This scenario cannot occur in practice.

### Acceptance Examples

- AE1. **Covers R1, R4.** Given a vault with 100 PT deposited and 50 underlying wrapped, when a handler runs 500 random flash loan + wrap + unwrap + deposit + claim sequences, then ovrfloToken supply always equals marketTotalDeposited + wrappedUnderlying and vault PT balance never drops below marketTotalDeposited.
- AE2. **Covers R6, R7, R8.** Given a Book with an active loan, when the lender claims partial stream and the borrower repays the remainder, then closeLoan returns the NFT to the borrower and the lender's total received equals the original obligation.
- AE3. **Covers R10, R14.** Given an oracle rate of 0.5e18 and a deposit of 1e6 (MIN_PT_AMOUNT), when deposit is called, then toUser + toStream == 1e6 and no arithmetic revert occurs.
- AE4. **Covers R15.** Given a vault with 100 PT deposited, when a borrower flash-loans 50 PT, deposits it, unwraps the resulting ovrfloToken, acquires 50 PT externally, and the callback returns, then vault PT balance is 150, marketTotalDeposited is 150, and the borrower has underlying from the unwrap.
- AE5. **Covers R16.** Given a flash loan with feeBps = 50, when the callback changes the oracle rate from 0.95e18 to 0.01e18, then the fee is still calculated at 0.95e18 (rate is read before callback) and the borrower is charged the original fee.

### Success Criteria

- All invariant tests pass with >= 500 runs each.
- All fuzz tests pass with >= 256 runs.
- All attack scenario tests pass.
- No production contract changes (test-only modifications).
- Full test suite (existing + new) passes with `MAINNET_RPC_URL` set for fork tests.

### Scope Boundaries

**Deferred for later**

- Halmos formal verification (symbolic execution)
- Differential fuzzing against real mainnet state
- Gas optimization fuzzing
- Mutation testing (e.g., `forge mutate`)
- R20 (fee-on-transfer token edge case, cannot occur with Pendle PT tokens)

**Outside this product's identity**

- Changes to production contracts (any bug found during adversarial testing is tracked separately, not fixed in this effort)
- UI/E2E testing
- Performance/load testing

### Dependencies / Assumptions

- Invariant tests use mock Sablier for determinism (not real mainnet Sablier).
- Existing invariant pattern in `test/OVRFLOWrapUnwrap.invariant.t.sol` serves as the template for new invariant handler contracts.
- `foundry.toml` will be extended with an invariant profile for run count configuration.

Product Contract unchanged except R20 moved from active requirements to Deferred.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Separate handler contracts per component.** Vault invariants and Book invariants get separate handler contracts in separate test files. This isolates state spaces, simplifies ghost variable tracking, and matches the existing pattern where `OVRFLOWrapUnwrapHandler` is dedicated to wrap/unwrap. A shared handler would couple unrelated state machines and make invariant assertions harder to reason about.

- KTD2. **Mock Sablier for all invariant and fuzz tests.** Real Sablier on a fork introduces nondeterminism (stream IDs depend on global state, timing depends on block.timestamp). The existing `OVRFLOWrapUnwrap.invariant.t.sol` already uses `vm.mockCall` for Sablier. New invariant tests follow the same pattern with a mock Sablier contract that supports NFT transfer semantics for Book tests.

- KTD3. **`foundry.toml` invariant profile with 500 runs.** Add a `[profile.invariant]` section with `runs = 500` and `depth = 25` (Foundry defaults: 256 runs, 15 depth). The profile is selected via `forge test --match-contract .*Invariant --profile invariant`. This persists the configuration and avoids passing CLI flags on every run.

- KTD4. **Ghost variable tracking in handlers.** Each handler tracks cumulative ghost variables (totalDeposited, totalClaimed, totalFlashLoaned, totalFeesPaid, etc.) to enable assertions that require cross-call accounting. The existing handler already does this with `totalWrapped` and `totalUnwrapped`. New handlers extend the pattern.

- KTD5. **Book invariant handler uses mock Sablier with NFT semantics.** The Book handler needs a Sablier mock that supports `transferFrom`, `ownerOf`, `approve`, `withdrawableAmountOf`, and `withdraw` (for claimLoan). This is a superset of the vault handler's needs, which only mock `createWithDurations`. The `OVRFLOBookMockSablier` in `test/OVRFLOBook.t.sol` already has these capabilities and serves as the template.

### Assumptions

- Foundry invariant tests with `targetContract` and `excludeContract` work as documented for multi-handler setups.
- `vm.mockCall` for Sablier's `createWithDurations` is sufficient for vault-level invariant tests (the stream ID just needs to be deterministic).
- The Book invariant handler can reuse the `OVRFLOBookMockSablier` pattern with minor extensions for invariant-specific ghost tracking.

### Sequencing

All four implementation units are independent test files with no cross-dependencies. They can be implemented in any order or in parallel. The `foundry.toml` change in U1 is the only shared infrastructure.

---

## Implementation Units

### U1. Vault invariant tests (handler-based)

**Goal:** Build a handler contract that randomly calls deposit, claim, wrap, unwrap, and flash loan, then assert vault-level accounting invariants after each call sequence.

**Requirements:** R1, R2, R3, R4, R5. Covers AE1.

**Dependencies:** None.

**Files:**
- Create: `test/OVRFLOInvariant.t.sol`
- Modify: `foundry.toml` (add `[profile.invariant]` section)

**Approach:** Extend the existing `OVRFLOWrapUnwrapHandler` pattern from `test/OVRFLOWrapUnwrap.invariant.t.sol` with three new handler functions: `flashLoan` (random amount, random borrower, with a `FlashBorrower` that performs no callback actions or optionally deposits/wraps), `flashLoanWithFee` (sets a random feeBps before the loan), and `claim` (already exists in the handler but needs to handle the pre-maturity gate correctly). The flashLoan handler function must guard with `if (block.timestamp >= expiry) return;` to avoid revert noise after a prior claim warps to maturity (flashLoan requires pre-maturity). For the deposit-during-callback variant, the FlashBorrower must be pre-funded with external PT (via mock PT.mint) to cover repayment, since depositing the flash-loaned PT into the vault means the borrower no longer holds it for the safeTransferFrom repayment. The wrap/unwrap callback variants repay from the flash-loaned PT itself and need no external funding. The handler tracks ghost variables: `totalFlashLoaned`, `totalFeesPaid`, `totalDeposited`, `totalClaimed`. The invariant test contract asserts: (1) `ovrfloToken.totalSupply() == sum(marketTotalDeposited) + wrappedUnderlying`, (2) `pt.balanceOf(vault) >= marketTotalDeposited` for each market, (3) `underlying.balanceOf(vault) >= wrappedUnderlying`, (4) flash loan handler never changes `marketTotalDeposited` or vault PT balance, (5) nested flash loan always reverts. Use `vm.mockCall` for Sablier `createWithDurations` (same as existing pattern) and for `IPendleOracle.getPtToSyRate` (same as existing pattern). The flash loan borrower contract follows the `FlashBorrower` pattern from `test/OVRFLOFlashLoan.t.sol` but simplified for invariant use (always returns success hash, optionally performs a callback action based on a random seed).

**Patterns to follow:**
- `test/OVRFLOWrapUnwrap.invariant.t.sol` -- handler structure, ghost variables, invariant assertions, setUp pattern
- `test/OVRFLOFlashLoan.t.sol` -- `FlashBorrower` contract pattern, `IFlashBorrower` callback

**Test scenarios:**
- Covers AE1. After 500 random operation sequences (deposit, claim, wrap, unwrap, flash loan), ovrfloToken supply equals marketTotalDeposited + wrappedUnderlying.
- Happy path: vault PT balance >= marketTotalDeposited after any sequence of flash loans (with and without fees).
- Happy path: vault underlying balance >= wrappedUnderlying after any sequence including flash loan fee payments.
- Edge case: flash loan with feeBps = 100 (max fee) does not break supply accounting.
- Edge case: flash loan of exactly marketTotalDeposited (max amount) does not break accounting.
- Edge case: claim after warp to maturity, then deposit on a new series, verify accounting resets correctly.
- Integration: flash loan callback that deposits PT, verify marketTotalDeposited increases and supply accounting holds.
- Integration: flash loan callback that wraps underlying, verify wrappedUnderlying increases and supply accounting holds.
- Error path: nested flash loan always reverts (nonReentrant guard), verify vault state unchanged.
- Error path: flash loan with insufficient borrower PT for repayment reverts, verify vault state unchanged.
- Verification: `forge test --match-contract OVRFLOInvariant --profile invariant` passes with 500 runs.

### U2. Book invariant tests (handler-based)

**Goal:** Build a handler contract that randomly calls Book operations (postSaleOffer, postSaleListing, buyListing, sellIntoOffer, postLendOffer, postBorrowListing, lendAgainstListing, borrowAgainstOffer, cancelSaleOffer, cancelSaleListing, cancelLendOffer, cancelBorrowListing, claimLoan, repayLoan, closeLoan), then assert Book-level accounting invariants.

**Requirements:** R6, R7, R8, R9. Covers AE2.

**Dependencies:** None.

**Files:**
- Create: `test/OVRFLOBookInvariant.t.sol`

**Approach:** Create a `OVRFLOBookInvariantHandler` contract that wraps each Book function with random inputs. The handler needs a mock Sablier with full NFT semantics (transferFrom, ownerOf, approve, withdrawableAmountOf, withdraw) and a mock factory/core/underlying/ovrfloToken setup similar to `test/OVRFLOBook.t.sol`. Ghost variables track per-loan state: obligation, lenderReceived, borrowerRepaid, loanClosed, nftOwner. The handler manages a pool of actors (sellers, buyers, lenders, borrowers) and routes operations to them with valid preconditions (e.g., only claim on an active loan, only repay if outstanding > 0). The invariant test contract asserts: (1) each loan's obligation <= stream remaining at origination, (2) lender total received <= obligation for each loan, (3) stream NFT is with borrower when loan is closed, (4) book underlying balance == sum(active sale offer capacities + active lend offer capacities) after every call (no stray dust). Use the `OVRFLOBookMockSablier` from `test/OVRFLOBook.t.sol` as the template, extended with ghost tracking if needed.

**Patterns to follow:**
- `test/OVRFLOBook.t.sol` -- `OVRFLOBookMockSablier`, `OVRFLOBookMockFactory`, `OVRFLOBookMockCore`, `OVRFLOBookMockERC20`, setUp pattern, `_mintEligibleStream` helper
- `test/OVRFLOWrapUnwrap.invariant.t.sol` -- handler structure, ghost variables, `targetContract`, invariant function pattern

**Test scenarios:**
- Covers AE2. After 500 random Book operation sequences, loan obligation never exceeds stream remaining, lender total never exceeds obligation, NFT always returned on close, no stray underlying in book (book balance == escrowed offer capacity).
- Happy path: post sale listing -> buy listing -> verify NFT transferred to buyer, underlying distributed, book balance == 0 (no active offers).
- Happy path: post lend offer -> borrow against offer -> lender claims -> borrower repays -> close loan -> verify NFT returned to borrower.
- Edge case: partial claim by lender, then full repayment by borrower, then closeLoan -- verify accounting across all steps.
- Edge case: cancel sale listing after posting -- verify NFT returned to seller, no underlying stuck.
- Edge case: multiple concurrent loans from the same lender offer -- verify capacity tracking is correct.
- Integration: borrow against offer, warp time, lender claims partial stream, borrower repays remainder, closeLoan returns NFT.
- Error path: attempt to claim from wrong lender reverts, loan state unchanged.
- Error path: attempt to repay more than outstanding reverts, loan state unchanged.
- Verification: `forge test --match-contract OVRFLOBookInvariant --profile invariant` passes with 500 runs.

### U3. Fuzz tests for math and oracle edges

**Goal:** Add targeted fuzz tests that pass random inputs to critical math functions and verify correctness properties.

**Requirements:** R10, R11, R12, R13, R14. Covers AE3.

**Dependencies:** None.

**Files:**
- Create: `test/OVRFLOFuzz.t.sol`

**Approach:** Create a fuzz test contract that uses the existing mock patterns (`MockERC20`, `vm.mockCall` for oracle and Sablier) to test individual functions with random inputs. Each fuzz test function takes `uint256` parameters and uses `bound` to constrain them to valid ranges. Tests include: (1) deposit split: fuzz `rateE18` (0 to 2e18) and `ptAmount` (1e6 to 1000 ether), call `previewDeposit`, assert `toUser + toStream == ptAmount` and `toUser <= ptAmount`; (2) flash loan fee: fuzz `amount` (1 to 100 ether), `rateE18` (0 to 1.5e18), `feeBps` (0 to 100), compute expected fee manually and compare to actual; (3) StreamPricing bounds: fuzz `remaining` (1 to 1000 ether), `aprBps` (0 to 10000), `timeToMaturity` (0 to 365 days), assert `grossPrice <= remaining` and `obligation <= remaining`; (4) dust amounts: fuzz `amount` from 1 to 100 wei for wrap/unwrap/flashLoan, and from 1e6 to 100e6 for deposit (MIN_PT_AMOUNT floor), call deposit, wrap, unwrap, flash loan, verify no reverts and correct accounting; (5) oracle edges: parametric test with rate = 0, rate = 1e18 (should revert with "nothing to stream"), rate >= 1e18 (should revert with "nothing to stream"), rate = 0.5e18 (normal).

**Patterns to follow:**
- `test/StreamPricing.math.t.sol` -- existing fuzz test pattern (`test_Fuzz_RealisticRange_ResidualNeverUnderflows`)
- `test/OVRFLO.t.sol` -- `_mockRate`, `_mockSablier`, `_deposit` helpers
- `test/OVRFLOFlashLoan.t.sol` -- `_computeFee` helper, `FlashBorrower` pattern

**Test scenarios:**
- Covers AE3. Fuzz deposit with rate = 0.5e18 and amount = 1e6 (MIN_PT_AMOUNT): toUser + toStream == 1e6, no revert.
- Happy path: fuzz deposit with random rate (0.01e18 to 0.99e18) and random amount (1e6 to 1000 ether), assert toUser + toStream == ptAmount.
- Happy path: fuzz flash loan fee with random amount, rate, and feeBps, assert fee matches formula.
- Happy path: fuzz StreamPricing.grossPrice with random remaining, aprBps, timeToMaturity, assert grossPrice <= remaining.
- Edge case: fuzz with amount = 1 wei through wrap, unwrap, flash loan -- no reverts, correct accounting. Deposit dust bounded to [1e6, 100 ether] (MIN_PT_AMOUNT floor).
- Edge case: deposit with rate = 0: toUser = 0, toStream = ptAmount, no revert.
- Edge case: deposit with rate = 1e18 (at par): toUser = ptAmount, toStream = 0, reverts with "nothing to stream".
- Edge case: deposit with rate >= 1e18 (at or above par): toUser capped at ptAmount, toStream = 0, reverts with "nothing to stream".
- Error path: flash loan with amount > marketTotalDeposited always reverts.
- Verification: `forge test --match-contract OVRFLOFuzz` passes with 256 runs.

### U4. Attack scenario integration tests

**Goal:** Write multi-step integration tests that simulate specific attack vectors and verify the protocol blocks them or handles them correctly.

**Requirements:** R15, R16, R17, R18, R19. Covers AE4, AE5.

**Dependencies:** None.

**Files:**
- Create: `test/OVRFLOAttackScenarios.t.sol`

**Approach:** Create an attack scenario test contract with full protocol setup (factory, vault, book, mock Sablier, mock oracle, multiple PT tokens for multi-market tests). Each test is a self-contained scenario with explicit setup, execution, and assertions. Use the existing mock patterns from `test/OVRFLOFlashLoan.t.sol` (FlashBorrower with configurable callbacks) and `test/OVRFLOBook.t.sol` (mock Sablier with NFT semantics). Scenarios: (1) full OVRFLO cycle: flash loan -> deposit -> unwrap -> acquire PT externally -> callback returns -> verify state; (2) oracle manipulation: flash loan with fee, callback changes oracle rate, verify fee uses pre-callback rate; (3) stream withdrawal during loan: create loan, lender claims partial stream, borrower repays, closeLoan, verify accounting; (4) multi-market: approve two markets with different PT tokens on same underlying, deposit on market A, flash loan market B, verify independence; (5) reentrancy via callback then claim: flash loan callback deposits, attempts claim during callback (no warp), verify claim reverts with "OVRFLO: not matured" because block.timestamp < expiry.

**Patterns to follow:**
- `test/OVRFLOFlashLoan.t.sol` -- `FlashBorrower` with configurable callbacks, full vault setup
- `test/OVRFLOBook.t.sol` -- Book setup with mock Sablier, `_mintEligibleStream`, `_originateLoanViaOffer`
- `test/OVRFLO.t.sol` -- multi-market setup (two PT tokens, two markets)

**Test scenarios:**
- Covers AE4. Full OVRFLO cycle: flash loan 50 PT, deposit into vault, unwrap ovrfloToken, borrower acquires 50 PT externally, callback returns, verify vault PT balance == 150, marketTotalDeposited == 150, borrower has underlying from unwrap.
- Covers AE5. Oracle manipulation: set feeBps = 50, flash loan with rate = 0.95e18, callback changes mock rate to 0.01e18, verify fee is still calculated at 0.95e18 (rate read before callback).
- Happy path: stream withdrawal during active loan -- create loan, set withdrawable amount, lender claims partial, borrower repays remainder, closeLoan returns NFT, verify lender total == obligation.
- Happy path: multi-market independence -- approve two markets with different PT tokens, deposit on market A, flash loan market B's PT, verify market A's marketTotalDeposited unchanged, market B's PT balance correct.
- Error path: reentrancy via callback then claim -- flash loan callback deposits, attempts claim (should revert because block.timestamp < expiry), verify vault state unchanged.
- Edge case: flash loan with max fee (100 bps) and max amount (marketTotalDeposited), verify correct fee and full repayment.
- Verification: `forge test --match-contract OVRFLOAttackScenarios` passes.

---

## Verification Contract

| Command | What it verifies | Applicability |
|---|---|---|
| `forge build` | Compilation succeeds with all new test files | All units |
| `forge test --match-contract OVRFLOInvariant --profile invariant` | Vault invariants hold across 500 random sequences | U1 |
| `forge test --match-contract OVRFLOBookInvariant --profile invariant` | Book invariants hold across 500 random sequences | U2 |
| `forge test --match-contract OVRFLOFuzz` | Fuzz tests pass with 256 runs | U3 |
| `forge test --match-contract OVRFLOAttackScenarios` | All attack scenario tests pass | U4 |
| `forge test` | Full non-fork suite passes (existing + new) | All units |
| `set -a && source .env && set +a && forge test` | Full suite including fork tests passes | All units |
| `forge coverage` | Source coverage remains >= 94% branches | All units |

---

## Definition of Done

**Global:**
- All four test files created and passing.
- `foundry.toml` has `[profile.invariant]` section with `runs = 500`.
- No production contract files modified.
- Full test suite (existing 239 + new tests) passes with `MAINNET_RPC_URL` set.
- Source coverage remains at or above current levels (100% lines, 94% branches).

**Per-unit:**
- U1: Vault invariant suite passes at 500 runs, all 5 invariants (R1-R5) asserted.
- U2: Book invariant suite passes at 500 runs, all 4 invariants (R6-R9) asserted.
- U3: Fuzz suite passes at 256 runs, all 5 fuzz targets (R10-R14) covered.
- U4: All 5 attack scenarios (R15-R19) pass, covering AE4 and AE5.

**Cleanup:**
- No experimental handler code or debug assertions left in final test files.
- No unused mock contracts or imports.
- All test files follow `forge fmt` formatting.
