---
title: Test Quality Patterns to Avoid in Solidity/Foundry Projects
date: 2026-07-15
category: docs/solutions/best-practices
module: test-suite-quality
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Writing or reviewing Solidity/Foundry test suites, especially fuzz, invariant, fork, and property-based tests
  - A test suite passes but may be masking real issues through vacuous assertions, wrong-reason passes, or unfalsifiable properties
  - Setting up Echidna/Medusa fuzz campaigns or Foundry wrapper contracts
root_cause: logic_error
resolution_type: test_fix
tags:
  - solidity
  - foundry
  - test-quality
  - fuzz
  - invariant
  - assertion
  - mock
  - expectrevert
---

# Test Quality Patterns to Avoid in Solidity/Foundry Projects

## Context

A comprehensive external test quality review of the OVRFLO protocol (a
Solidity/Foundry DeFi project) surfaced 18 findings across the test suite.
After verifying each finding against source and fixing systematically, all 365
tests pass. The striking thing about this review was not the finding count but
the *shape*: nearly every finding was a test that passed for the wrong reason.
The suite was green, but green lied. The failures fell into a small number of
recurring anti-patterns that generalize to any Solidity/Foundry project, not
just this one:

- Assertions that cannot fail by construction (tautologies, vacuous bounds,
  unfalsifiable fast paths).
- `vm.expectRevert()` with no argument that matches *any* revert, masking the
  fact that the wrong function reverted.
- Values derived from balance deltas that cancel out when buyer and seller
  share an address.
- Tests whose name promises one behavior but whose body duplicates another
  (misnamed, duplicate, or dead).
- Math boundary branches (`value += 1` ceil logic) that no input exercises, so
  deleting the branch fails no test.
- Fuzz loops starting at ID 0 where real IDs start at 1, silently swallowed by
  try/catch.
- Mocks that return spec-incorrect values (e.g. `ownerOf` returning
  `address(0)` instead of reverting), hiding integration-time revert behavior.
- Missing runner configuration (`echidna.yaml` with no `testContract`) and
  empty stub contracts that pass because they assert nothing.

The shared root cause across all of them: **a test passing is not the same as
a test proving something**. The fixes below are not protocol fixes; they are
test fixes that make each assertion actually constrain the behavior it claims
to constrain.

## Guidance

### 1. Make every assertion falsifiable

Before writing an assertion, ask: "is there any code change that would make
this fail?" If the answer is no, the assertion is documentation, not a test.
Three sub-patterns to watch:

- **Tautological assertions** where the right-hand side is computed from the
  left-hand side (`grossPrice == netToSeller + fee` when
  `netToSeller = grossPrice - fee`).
- **Vacuous bounds** like `assertGe(balance, 0)` that hold for every possible
  value of the type.
- **Unfalsifiable fast paths** where the chosen inputs route execution through
  a branch that returns the exact value the assertion checks, bypassing the
  calculation under test.

The fix in each case is to assert an *independent* consequence: the fee
actually arriving in the treasury, the actual minted return equaling the
captured deposit return value, or inputs that force the non-fast-path
calculation.

### 2. Never use bare `vm.expectRevert()` when you mean a specific error

`vm.expectRevert()` with no argument matches the next *any* revert. If an
earlier call in the setup sequence reverts for an unrelated reason, the test
still passes. Always pass the expected selector or message string:

```solidity
vm.expectRevert(StreamPricing.SeriesMatured.selector);
```

When the test setup itself performs a state-changing call (e.g. supplying
fresh liquidity) before the call-under-test, order the setup *before* the
`vm.expectRevert()` so the revert expectation binds to the intended call, not
to setup.

### 3. Derive values from the contract's own views, not from balance deltas across shared addresses

In fuzz handlers, computing
`grossPrice = actorBalanceBefore - actorBalanceAfter` breaks the moment buyer
and seller are the same actor: the payment the seller receives lands at the
same address the buyer paid from, canceling the delta. Pull the value from the
contract's own quote/view so the number reflects the protocol's perspective,
independent of which actor is involved.

### 4. Exercise the boundary branch, not just the happy path

Ceil/floor rounding branches (`if (mulmod != 0) value += 1;`) are the classic
untested boundary: random fuzz almost never lands `mulmod != 0` at the exact
scale, and happy-path inputs sail through the floor. Construct a deterministic
input where `mulmod != 0` and assert `ceil == floor + 1`. The test should fail
if someone deletes the `+ 1`.

### 5. Start loops at the real first ID

When iterating entity IDs in a property or view test, start at the first ID the
contract actually mints (usually 1, not 0). A `try/catch` around each iteration
turns an off-by-one into a silent no-op: every iteration reverts on the
nonexistent ID 0, the catch swallows it, and the loop body never runs for the
real entities.

### 6. Keep ghost state in sync with every state transition the handler can trigger

Fuzz handlers maintain "ghost" variables that mirror protocol state for
invariant checks. When a handler call can close a loan, return a stream, or
reset a counter, update the ghost *in the same handler branch*. A missing
ghost update on one branch causes false-positive invariant violations later
(e.g. a re-pledged stream appears still-pledged), which wastes triage time and
erodes trust in the suite.

### 7. Make mocks match the spec, not just "good enough for current tests"

A mock that returns `address(0)` for `ownerOf(nonexistent)` instead of
reverting is spec-incorrect. It may not break today's tests (especially if
callers use try/catch), but it hides the revert behavior that the real
integration exposes. Mocks should enforce the same revert paths and return
conventions as the real contract.

### 8. Name tests for what they actually do, and delete duplicates

A test named `..._SucceedsOnClosedLoanAfterPartialRepay` with no `repayLoan`
call is lying. Either add the partial repay and adjust assertions, or rename.
Byte-identical duplicate invariant tests give no extra coverage and inflate the
pass count misleadingly; delete them.

### 9. Match the contract's computation order in fork tests

When a fork test reproduces a contract's fee math, match the exact `mulDiv`
order (divide-then-multiply vs multiply-then-divide). For whole-token amounts
the truncation difference is invisible; for fractional amounts the results
diverge and the test asserts a value the contract never computes.

### 10. Wire up the runner config and don't ship empty stubs

`echidna.yaml` without `testContract` means Echidna never instantiates the
fuzzer; an empty `FoundryTester.sol` with no test functions is a validation
gap that an auditor will flag. Add the field and at least a smoke test.

## Why This Matters

A test suite's value is the set of regressions it *would* catch, not the number
of tests that pass. Every anti-pattern above converts a "passing" test into a
no-op: the tautology that can't fail, the bare `expectRevert` that matches the
wrong revert, the balance delta that cancels to zero, the boundary branch no
input reaches, the loop that swallows every iteration. The danger is
asymmetric: a real bug slips through a no-op test silently, while a flaky or
false-positive test at least makes noise. Silent non-coverage is the worst
outcome because it produces confidence without constraint.

The cost compounds in a fuzz suite. Stateful fuzz handlers that derive values
incorrectly or skip ghost updates produce false-positive invariant violations
that burn triage time, and worse, can produce false *negatives* where a real
invariant break is masked by ghost state that says everything is fine. Getting
the handler accounting right once is cheaper than triaging phantom violations
forever.

The review also showed that these patterns are cheap to fix once recognized:
most fixes are one to three lines. The expensive part is *recognizing* them,
because a green test looks identical to a real test. Treat any assertion you
cannot mentally falsify as a smell, and any `expectRevert()` without an
argument as a bug waiting to happen.

## When to Apply

- When writing or reviewing a Solidity/Foundry test and the assertion's truth
  is guaranteed by how its operands were computed (apply Pattern 1).
- When a test uses `vm.expectRevert()` with no argument, or when setup performs
  state changes before the call-under-test (apply Pattern 2).
- When a fuzz handler derives a price or amount from balance deltas that could
  be shared by two roles (apply Pattern 3).
- When a contract has ceil/floor or conditional `+ 1` rounding logic and no
  deterministic test targets the non-default branch (apply Pattern 4).
- When a property or view test loops over entity IDs inside a `try/catch`
  (apply Pattern 5).
- When adding or modifying a fuzz handler that can trigger a state transition
  (loan close, stream return, counter reset) tracked by a ghost variable
  (apply Pattern 6).
- When a mock diverges from the real contract's revert or return spec (apply
  Pattern 7).
- When a test's name describes a behavior not present in its body, or two
  invariants are byte-identical (apply Pattern 8).
- When a fork or integration test recomputes a contract's arithmetic locally
  (apply Pattern 9).
- When configuring Echidna/Medusa or shipping a Foundry wrapper for a fuzz
  suite (apply Pattern 10).

## Examples

### Example 1 -- Tautological property assertion

The property asserted `grossPrice == netToSeller + fee`, but the handler
computed `netToSeller = grossPrice - fee`. This is
`grossPrice == (grossPrice - fee) + fee`, true for every input.

```solidity
// BEFORE -- can never fail; RHS is derived from LHS.
property_sale_settlement_conservation(grossPrice, fee, grossPrice - fee);
```

```solidity
// AFTER -- asserts an independent consequence: the fee reached the treasury.
uint256 treasuryDelta = stateAfter.treasuryUnderlying - stateBefore.treasuryUnderlying;
eq(treasuryDelta, fee, "SP-99: treasury did not receive exact fee");
```

### Example 2 -- Unfalsifiable fuzz fast path

With `borrowAmount == grossPrice`, `obligationForFill` hits the fast path that
returns the exact remaining amount, bypassing the real calculation.

```solidity
// BEFORE -- fast path returns the exact value; test cannot fail.
obligationForFill(gp, gp, /* ... */);
```

```solidity
// AFTER -- half the gross price forces the non-fast-path calculation.
obligationForFill(gp / 2, gp, /* ... */);
```

### Example 3 -- Vacuous lower bound

`assertGe(ovrfloToken.balanceOf(user), 0)` holds for every ERC20 balance.

```solidity
// BEFORE -- trivially true for any uint256 balance.
assertGe(ovrfloToken.balanceOf(user), 0);
```

```solidity
// AFTER -- capture the deposit return and assert the exact minted amount.
uint256 depositedToUser = ovrflo.deposit(market, amount, user);
assertEq(ovrfloToken.balanceOf(user), depositedToUser);
```

### Example 4 -- Bare `vm.expectRevert()` masking the wrong revert

The maturity test passed because `supplyLiquidity` reverted with `SeriesMatured`
after the time warp, but the test intended to assert that
`createBorrowerLoanPool` reverts.

```solidity
// BEFORE -- matches ANY revert; setup call's revert satisfies it.
vm.warp(block.timestamp + 30 days);
vm.expectRevert();                          // supplyLiquidity reverts here
lending.supplyLiquidity(/* fresh liquidity */);
lending.createBorrowerLoanPool(/* ... */);  // never reached, never asserted
```

```solidity
// AFTER -- supply fresh liquidity pre-warp; assert the specific selector on
// the call-under-test.
lending.supplyLiquidity(/* fresh liquidity */);   // setup, pre-warp
vm.warp(block.timestamp + 30 days);
vm.expectRevert(StreamPricing.SeriesMatured.selector);
lending.createBorrowerLoanPool(/* ... */);
```

### Example 5 -- Balance-delta derivation across a shared address

In `oVRFLOLending_buyListing`, when buyer == seller the payment returns to the
same address, making the delta zero or wrong.

```solidity
// BEFORE -- cancels to zero when buyer == seller.
uint256 grossPrice = stateBefore.actorUnderlying - stateAfter.actorUnderlying;
```

```solidity
// AFTER -- pull the price from the contract's own quote.
(uint256 grossPrice, bool active) = _listingPrice(listingId);  // calls lending.quote()
if (!active) return;
```

### Example 6 -- Pinned math boundary

The `obligation` function's `if (mulmod != 0) value += 1;` ceil branch was
never exercised; deleting the `+ 1` would fail no test.

```solidity
// AFTER -- deterministic input where mulmod != 0, asserting ceil == floor + 1.
function test_Obligation_CeilPinnedExercisesAddOne() public {
    uint256 borrowAmount = 97e18 + 1;   // chosen so mulmod(r, b, 1e18) != 0
    (uint256 ceil, uint256 floor) = StreamPricing.obligationBounds(borrowAmount, /* ... */);
    assertEq(ceil, floor + 1, "ceil must exceed floor when mulmod != 0");
}
```

### Example 7 -- Fuzz loop starting at nonexistent ID 0

Stream/pool/listing IDs start at 1; ID 0 doesn't exist and reverts, swallowed
by try/catch, making the whole loop a no-op.

```solidity
// BEFORE -- every iteration reverts on ID 0; catch swallows it; body never runs.
for (uint256 i = 0; i < maxId; i++) {
    try lending.loanState(i) { /* assert */ } catch {}
}
```

```solidity
// AFTER -- start at the first real ID.
for (uint256 i = 1; i < maxId; i++) {
    try lending.loanState(i) { /* assert */ } catch {}
}
```

### Example 8 -- Fuzz handler ghost recording gap

`repayLoan` didn't record `ghost_loanStreamWithdrawnAtClose[loanId]` when a
loan closed via full repayment, causing GL-70 false positives when the returned
stream was re-pledged.

```solidity
// BEFORE -- ghost not updated on the close branch.
function oVRFLOLending_repayLoan(uint256 loanId, uint256 amount) public {
    lending.repayLoan(loanId, amount);
    // ... ghost updates for outstanding, but nothing for the closed-stream case
}
```

```solidity
// AFTER -- record the close snapshot so re-pledge doesn't look like reuse.
function oVRFLOLending_repayLoan(uint256 loanId, uint256 amount) public {
    lending.repayLoan(loanId, amount);
    if (lending.loanState(loanId).closed) {
        ghost_loanStreamWithdrawnAtClose[loanId] = sablier.getWithdrawnAmount(streamId);
    }
}
```

### Example 9 -- Mock `ownerOf` spec non-compliance

`MockSablier.ownerOf` returned `address(0)` for unowned tokens instead of
reverting, hiding the ERC721 revert path.

```solidity
// BEFORE -- returns zero instead of reverting; hides integration revert.
function ownerOf(uint256 tokenId) public view override returns (address) {
    return streams[tokenId].owner;   // address(0) if nonexistent
}
```

```solidity
// AFTER -- revert per ERC721 spec.
function ownerOf(uint256 tokenId) public view override returns (address) {
    address owner = streams[tokenId].owner;
    require(owner != address(0), "ERC721: invalid token ID");
    return owner;
}
```

### Example 10 -- Misnamed test with no partial repay

`test_ClaimLoanPoolShare_SucceedsOnClosedLoanAfterPartialRepay` had no
`repayLoan` call; it duplicated the plain closed-loan test.

```solidity
// BEFORE -- name promises a partial repay; body has none.
function test_ClaimLoanPoolShare_SucceedsOnClosedLoanAfterPartialRepay() public {
    // ... close loan directly, assert claim ...
    // (identical to the plain closed-loan test)
}
```

```solidity
// AFTER -- actually repay partially, then assert the repaid amount is claimable.
function test_ClaimLoanPoolShare_SucceedsOnClosedLoanAfterPartialRepay() public {
    lending.repayLoan(loanId, 30 ether);          // the partial repay the name promises
    lending.closeLoan(loanId);
    // assert the 30 ether repaid portion is reflected in claimable proceeds
}
```

### Example 11 -- Duplicate invariant test

`invariant_FlashLoanDoesNotDrainVault` was byte-identical to
`invariant_PtBalanceGteDeposited`.

```solidity
// BEFORE -- two tests, one assertion, zero extra coverage.
function invariant_FlashLoanDoesNotDrainVault() public {
    assertLe(ovrflo.marketTotalDeposited(MARKET), pt.balanceOf(address(ovrflo)));
}
function invariant_PtBalanceGteDeposited() public {       // R2
    assertLe(ovrflo.marketTotalDeposited(MARKET), pt.balanceOf(address(ovrflo)));
}
```

```solidity
// AFTER -- delete the duplicate; keep one invariant with a clear name.
function invariant_PtBalanceGteDeposited() public {
    assertLe(ovrflo.marketTotalDeposited(MARKET), pt.balanceOf(address(ovrflo)));
}
```

### Example 12 -- Dead mock call masked by a fallback mock

`test_Fuzz_DepositMinAmount` called `_mockSablier(user, ...)` with a
specific-calldata mock whose calldata never matched the actual call; `setUp`'s
selector-wide mock silently covered it.

```solidity
// BEFORE -- specific mock never matches; test passes only via the fallback.
function test_Fuzz_DepositMinAmount(uint256 amount) public {
    _mockSablier(user, /* specific calldata that never matches */);
    ovrflo.deposit(market, amount, user);
}
```

```solidity
// AFTER -- remove the dead specific mock; rely on the setUp selector mock.
function test_Fuzz_DepositMinAmount(uint256 amount) public {
    ovrflo.deposit(market, amount, user);
}
```

### Example 13 -- Computation order mismatch in a fork test

The fork test computed the flash fee in a different `mulDiv` order than the
contract; results diverge for fractional amounts.

```solidity
// BEFORE -- multiply-then-divide; truncation order differs from contract.
uint256 fee = FLASH_AMOUNT * liveRate * feeBps / 1e18 / 10000;
```

```solidity
// AFTER -- divide-then-multiply, matching the contract's mulDiv order.
uint256 fee = (FLASH_AMOUNT * liveRate / 1e18) * feeBps / 10000;
// Contract: PRBMath.mulDiv(PRBMath.mulDiv(amount, rate, 1e18), feeBps, 10000)
```

### Example 14 -- Missing runner config and empty stub

`echidna.yaml` had no `testContract`; `FoundryTester.sol` was an empty stub.

```yaml
# BEFORE -- Echidna can't tell which contract to fuzz.
# echidna.yaml (no testContract field)
```

```yaml
# AFTER -- name the fuzzer contract.
testContract: "FuzzTester"
```

```solidity
// BEFORE -- FoundryTester.sol: empty, no test functions.
contract FoundryTester {
}
```

```solidity
// AFTER -- at least a smoke test so the wrapper exercises the harness.
contract FoundryTester is FuzzTester {
    function test_smoke_setup() public {
        // call setup and one handler to confirm the harness is wired
    }
}
```

## Related

- [Closing stateful fuzz coverage gaps](../best-practices/closing-stateful-fuzz-coverage-gaps.md) -- companion campaign on handler expansion, mock fidelity, and property triage; same "green is lying" theme from the fuzz angle
- [Solidity test coverage review](../best-practices/solidity-test-coverage-review.md) -- the coverage audit that motivates locking guard branches and view-function negative tests
- [Sablier NFT approval fuzz reachability gap](../test-failures/sablier-nft-approval-fuzz-reachability-gap.md) -- a related case where a green fuzz suite was vacuous because of a missing harness capability
- [GL-70 stream reuse after loan close](../logic-errors/stream-reuse-after-loan-close-property-fix.md) -- the invariant that the ghost-recording fix (Example 8) protects
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) -- the enforceable rules the test suite encodes
- [Verify token balance movement, not just ownership](../best-practices/verify-token-balance-movement-not-just-ownership.md) -- canonical instance of the vacuous-assertion pattern
