---
title: Closing stateful fuzz coverage gaps - handler expansion, mock fidelity, and property triage
category: best-practices
module: test/fizz/
date: 2026-07-05
last_updated: 2026-07-15
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - "Expanding a Foundry/Medusa stateful fuzz suite to cover previously-unreachable protocol paths"
  - "Improving mock fidelity so a fuzz harness exercises the same revert paths the real integration exposes"
  - "Triaging violations that surface after adding handler coverage or rate-variation to a fuzz campaign"
  - "Deciding whether a fuzz violation is a real protocol bug or a harness false positive from cross-actor transfers, rate changes, or reentrancy"
  - "Structuring a one-shot fuzz coverage campaign with end-of-line triage rather than incremental per-handler validation"
tags: [fuzz, medusa, stateful-fuzz, test-coverage, mock-fidelity, property-triage, ovrflo, foundry]
---

# Closing stateful fuzz coverage gaps: handler expansion, mock fidelity, and property triage

## Context

The OVRFLO protocol ships a stateful fuzz suite under `test/fizz/` driven by
Medusa, with properties documented in `PROPERTIES.md`. Before this campaign the
suite passed cleanly (110 tests, 0 failures) and met coverage targets
(84-92% across the five source contracts). A coverage evaluation, however,
exposed four structural blind spots that meant "green" was lying about real
coverage:

1. **`createBorrowPool` only ever used single-offer arrays**, so pattern #11
   (strictly-increasing offer IDs) and the multi-contributor pro-rata claim
   path in `_consumeOffers` were dead code in the harness.
2. **No handler advanced time randomly**, so `closeLoan` and `claimPoolShare`
   success paths (which require stream vesting) almost never fired.
3. **No `IFlashBorrower` implementation existed**, so the PT flash loan
   callback and its reentrancy window were entirely untested.
4. **`MockPendleOracle` returned a fixed 0.95e18 rate**, so deposit edge
   cases near rate 1.0 (the `toStream > 0` guard) and above 1.0 (the
   `toUser` cap) were unreachable.

Eight smaller gaps rounded out the list: `MockSablier` did not enforce the
`transferable` flag, no property tested the `sweepExcessPt` input-validation
guard (pattern #13), GL-57 (no free profit) and SP-62 (deposit liveness) were
skipped, and several minor functions (`prepareOracle`, `setTreasury`,
`gatherOfferCapacities`, direct ERC20 transfers) had no handler.

The friction was not "we have failing tests." It was that a suite can be green
and still leave entire protocol branches unexercised, and that the obvious
remedies (more actors, rate variation, a real flash borrower) introduce a
second, harder problem: the existing properties were written for the *old*
harness shape and start producing false positives the moment the state space
widens. This campaign closed all 12 gaps in 8 implementation units, then ran a
single validation campaign whose 4 violations were all triaged to harness
false positives and fixed, ending at 118 tests passing with 0 failures.

## Guidance

**Land all coverage changes in one batch, then triage at the end.** Rather
than running a Medusa campaign after each handler change and triaging
incrementally, implement every structural, mock, handler, property, and
scenario unit first, then run a single campaign. Mock fidelity changes
(transferability enforcement, rate variation) and structural changes
(7 actors, transfer handler) interact: a per-actor conservation property
breaks only once actors can transfer tokens to each other, and a
rate-monotonicity property breaks only once the oracle rate can change. Triage
once, after all the moving parts are in place, and you triage the *real*
interactions rather than chasing symptoms of an incomplete harness.

**Expand the actor roster to enable multi-party flows.** Going from 3 to 7
actors (Alice through Grace) is what makes multi-contributor pool scenarios
reachable: 4 offer makers, 1 borrower, and 2 spare actors for stream
sellers/buyers. The change is mechanical (`ACTOR_LABELS` extension, the
`setupActors` loop iterates `length` automatically, `toActor` modulus flips to
7, `medusa.json` gains 4 `senderAddresses`), but it is the precondition for
every multi-party property and scenario. Every global property that iterates
actors (GL-18, GL-60, GL-57) does more gas work per call, but the state
diversity is the point.

**Make mocks enforce the same revert paths the real integration does.** A mock
that is more permissive than the real contract hides bugs. Two fidelity fixes
mattered here:

```solidity
// MockSablier.transferFrom must enforce transferability, matching Sablier V2.
// Without this, sellIntoOffer / postSaleListing / createBorrowPool never see
// the "not transferable" revert that real streams produce.
function transferFrom(address from, address to, uint256 tokenId) public override {
    require(streams[tokenId].transferable, "not transferable");
    // ... ownership + balance update ...
}
```

```solidity
// MockPendleOracle rate variation, clamped to [0.8e18, 1.02e18] by a handler.
// The fixed 0.95e18 rate left the toStream > 0 guard (rate near 1.0) and the
// toUser cap (rate above 1.0) unreachable. A setRate handler exercises both.
function oVRFLO_setOracleRate(uint256 seed) public asActor {
    uint256 rate = 0.8e18 + (seed % (0.22e18)); // [0.8e18, 1.02e18)
    mockOracle.setRate(rate);
}
```

**Add a real `IFlashBorrower` with a reentrancy flag.** The flash loan callback
path is untestable without an `onFlashLoan` implementation. A single
`MockFlashBorrower` contract serves both the standard handler and the
reentrancy scenario via a boolean carried in the `bytes data` payload:

```solidity
// MockFlashBorrower.onFlashLoan toggles reentrancy via the data flag.
function onFlashLoan(address, uint256, uint256 fee, bytes calldata data)
    external returns (bytes32) {
    bool reenter = abi.decode(data, (bool));
    if (reenter) {
        // Deposit during the callback - the reentrancy window the vault allows.
        vault.deposit(market, 1e6, address(this));
    }
    // Repay PT + fee, return success hash.
    ptToken.transfer(address(vault), /* amount + fee */);
    underlying.transfer(address(vault), fee);
    return keccak256("IFlashBorrower.onFlashLoan");
}
```

**Generate multi-offer arrays by construction, not by sort.** The clamped
`createBorrowPool` handler picks 1-3 offer IDs from `[1, nextOfferId-1]`,
excludes the current actor's offers (self-match prevention), and guarantees
strictly-increasing ordering by picking in ascending order. Sorting a fuzzed
array is fragile; constructing an ordered array is deterministic and still
exercises the `offerIds[i] > offerIds[i-1]` check (pattern #11).

**Triage violations against the source, not against the property text.** When a
property fires, the first question is "did the protocol do something wrong, or
did my property assume a state shape that no longer holds?" Four violations
surfaced in this campaign, all false positives, each with a distinct root cause
and a distinct fix (see Examples). The discipline is: read the call sequence,
identify what state changed, check whether the property's assumption about that
state is still valid under the widened harness, and only then decide bug vs
false positive.

## Why This Matters

A green fuzz suite with unreachable branches gives false confidence. The
single-offer `createBorrowPool`, the untested flash loan callback, and the
fixed oracle rate were not edge cases; they were core protocol paths
(`_consumeOffers` multi-offer accumulation, EIP-4531 reentrancy, deposit
split math) that a real attacker or a real depositor would exercise. Coverage
percentage does not surface this: a function can be "hit" by a handler that
only ever passes one shape of input. The remedy is handler diversity
(multi-offer arrays, time advancement, rate variation, a real borrower), and
the cost of the remedy is that properties written for the narrow harness break.

This is the central tension of fuzz coverage work: widening the state space
finds more bugs but also breaks more properties, and a broken property is only
useful if you triage it correctly. Triaging a real bug as a false positive
ships a vulnerability; triaging a false positive as a real bug wastes a fix
cycle and can lead you to weaken a correct property. The four triage patterns
documented below (global-vs-per-actor conservation, holder-list completeness,
rate-stability gating, reentrancy-state separation) are reusable: any future
campaign that adds actors, tokens holders, rate variation, or reentrancy will
hit one of them.

The end state matters: 118 tests passing, 0 failures, coverage at or above
target on every contract (OVRFLO 92%, OVRFLOLending 90%, OVRFLOFactory 88%,
OVRFLOToken 88%, StreamPricing 100%). The previously-dead paths
(`closeLoan` success, `claimPoolShare` success, flash loan callback,
multi-offer `_consumeOffers`, `prepareOracle` TWAP bounds) are now hit in the
coverage report. The suite is green for the right reason.

## When to Apply

- When a fuzz suite passes cleanly but a coverage evaluation reveals entire
  branches that no handler reaches (single-shape input, fixed oracle, no time
  advancement, no callback implementer).
- When expanding the actor roster to enable multi-party flows (pools with
  multiple contributors, transfers between actors, multi-actor scenarios).
- When improving mock fidelity: enforce the same revert paths the real
  integration exposes (transferability, rate bounds), or you test a
  permissive fiction.
- When triaging violations that appear only after adding cross-actor transfers,
  rate variation, or a new token-holding contract: classify bug-vs-false-positive
  against the source before changing either the property or the contract.
- When a property assumes a static environment (fixed rate, fixed actor set,
  no reentrancy) and the harness is being widened: gate the property on the
  assumption (rate-stability check, holder-list completeness) or move the
  assertion to a scenario handler with its own tailored invariants.
- When structuring the campaign: prefer one-shot implementation with end-of-line
  triage over incremental per-handler validation, because the interactions
  between changes are the things that break properties.

## Examples

### Triage 1: GL-57 per-actor conservation false positive (global sum fix)

GL-57 ("no free profit") was originally a per-actor check: each actor's current
value (`underlying + PT + ovrfloToken`) must not exceed their start value plus
stream withdrawals. After U6 added a direct ERC20 transfer handler (R6) so
actors could move `ovrfloToken` between each other for GL-61/GL-62, the
per-actor property started firing: actor A transfers tokens to actor B, and A's
value drops below start while B's rises above start. Neither is a bug; value
just moved between actors.

The fix is to make the conservation check global, summing across all actors.
Value is conserved across the actor set as a whole; individual actors can
redistribute:

```solidity
// BEFORE (per-actor): fires when actors transfer tokens between each other.
for (uint256 i = 0; i < actors.length; i++) {
    address a = actors[i];
    uint256 current = underlying.balanceOf(a) + ptToken.balanceOf(a)
                    + ovrfloToken.balanceOf(a);
    lte(current, ghost_actorStartValue[a], "GL-57: actor value > start");
}

// AFTER (global sum): conserves value across the whole actor set, not per actor.
function property_no_free_profit() public {
    uint256 totalCurrent;
    uint256 totalStart;
    for (uint256 i = 0; i < actors.length; i++) {
        address a = actors[i];
        totalCurrent += underlying.balanceOf(a) + ptToken.balanceOf(a)
                      + ovrfloToken.balanceOf(a);
        totalStart += ghost_actorStartValue[a];
    }
    lte(totalCurrent, totalStart, "GL-57: total actor value exceeds total start value");
}
```

### Triage 2: GL-60 missing MockFlashBorrower in the holder sum

GL-60 asserts `totalSupply == sum of all known holder balances`. After U2/U4
introduced `MockFlashBorrower` (which can receive `ovrfloToken` via a
reentrant deposit), the holder sum no longer included every holder. The
property fired because `totalSupply` accounted for tokens held by the mock
borrower that the sum did not.

The fix is to add the new contract to the holder list, guarded by its
deployment sentinel. Any future contract that can hold `ovrfloToken` must be
added here, or GL-60 will false-positive:

```solidity
function property_total_supply_eq_holder_sum() public {
    uint256 sum = sumActorsERC20Balances(address(ovrfloToken));
    sum += ovrfloToken.balanceOf(address(vault));
    sum += ovrfloToken.balanceOf(address(book));
    sum += ovrfloToken.balanceOf(treasury);
    sum += ovrfloToken.balanceOf(SABLIER_ADDR);
    if (mockFlashBorrowerAddr != address(0)) {
        sum += ovrfloToken.balanceOf(mockFlashBorrowerAddr);
    }
    eq(ovrfloToken.totalSupply(), sum, "GL-60: totalSupply != sum of holder balances");
}
```

### Triage 3: SP-63 rate-change sensitivity (gate on rate stability)

SP-63 asserts `toUser` is non-decreasing in `ptAmount` for a fixed oracle rate.
After U3 added a rate-variation handler, the rate could change between the two
deposits the property compares, making the monotonicity comparison invalid: a
larger deposit at a lower rate can legitimately yield fewer tokens.

The fix is to gate the assertion on rate stability. The property receives the
previous rate as a parameter and reads the current rate; if they differ, it
returns without asserting, because the monotonicity guarantee only holds under
a fixed rate:

```solidity
function property_noShareInflation(
    uint256 prevToUser, uint256 prevPtAmount,
    uint256 toUser, uint256 ptAmount, uint256 prevRate
) internal {
    if (prevPtAmount > 0 && ptAmount > prevPtAmount) {
        uint256 currentRate = mockOracle.rate();
        if (currentRate != prevRate) return; // monotonicity only holds at fixed rate
        gte(toUser, prevToUser, "SP-63: toUser decreased for larger ptAmount");
    }
}
```

### Triage 4: SP-08 reentrancy PT balance change (separate reentrancy to a scenario handler)

SP-08 asserts the vault's PT balance is unchanged by a flash loan. This holds
for a standard flash loan (atomic repay, no state change). But the reentrancy
scenario (U7) deposits into the vault during the callback, which legitimately
increases `marketTotalDeposited` and the vault's PT balance. Running SP-08
after a reentrant flash loan is a false positive.

The fix is to separate the two paths entirely. The clamped handler passes
`abi.encode(false)` (non-reentrancy mode) and keeps the standard flash loan
property assertions, including SP-08. The reentrancy scenario passes
`abi.encode(true)` and uses its *own* tailored assertions that account for the
reentrant deposit (totalSupply == MTD + wrappedUnderlying, wrappedUnderlying
unchanged), without asserting SP-08:

```solidity
// Clamped handler: non-reentrancy mode, full standard property set.
function oVRFLO_flashLoan_clamped(address, uint256 amount, bytes memory) public {
    bytes memory flashData = abi.encode(false); // no reentrant deposit
    mockFlashBorrower.executeFlashLoan(amount, flashData);
    property_flashLoanAtomicRepay();    // SP-08: PT balance unchanged - valid here
    property_flashLoanMtdUnchanged();   // SP-36: MTD unchanged - valid here
    // ... wrappedUnchanged, preMaturity, noFreeProfit ...
}

// Scenario handler: reentrancy mode, its own assertions, no SP-08.
function scenario_flashLoanReentrancy(uint256 amount) public {
    uint256 wrappedBefore = vault.wrappedUnderlying();
    try mockFlashBorrower.executeFlashLoan(amount, abi.encode(true)) {
        // Reentrant deposit raises MTD and totalSupply; assert the GL-01 invariant
        // holds, not that individual components are unchanged.
        eq(ovrfloToken.totalSupply(),
           vault.marketTotalDeposited(market) + vault.wrappedUnderlying(),
           "R16: totalSupply != MTD + wrapped after reentrancy");
        eq(vault.wrappedUnderlying(), wrappedBefore,
           "R16: wrappedUnderlying changed in reentrancy");
    } catch {}
}
```

### Mock fidelity: transferability enforcement

Before the fix, `MockSablier.transferFrom` moved any stream regardless of its
`transferable` flag. After the fix, non-transferable streams revert, which
propagates through `sellIntoOffer`, `postSaleListing`, and `createBorrowPool`
exactly as it would against real Sablier V2. This is the difference between a
mock that lets the harness pass and a mock that lets the harness find bugs.

### Coverage outcome

After all 8 units and 4 triage fixes, the final Medusa campaign reported 118
tests passed with 0 failures. Coverage held or improved on every contract:
OVRFLO 92%, OVRFLOLending 90% (up from 84%), OVRFLOFactory 88% (up from 85%),
OVRFLOToken 88%, StreamPricing 100%. The previously-unreachable paths
(`closeLoan` success, `claimPoolShare` success, flash loan callback,
multi-offer `_consumeOffers`, `prepareOracle` TWAP bounds) all appear in the
coverage report. `PROPERTIES.md` checkboxes were flipped from `[-]` to `[x]`
for GL-57, GL-61, GL-62, SP-62, and the new pattern #13 (SP-77) property.

### Later campaign continuation (2026-07-13)

Two additional gaps surfaced in a subsequent campaign phase after the
MockSablier ACL was tightened further:

1. **Sablier NFT setApprovalForAll reachability gap**: `Base.setupActors()`
   granted ERC20 approvals but never called `setApprovalForAll` for Sablier
   NFT transfers. All stream-custody transitions reverted silently, making
   147/147 Medusa passes vacuous for lending paths (66.3% coverage). After the
   fix, coverage jumped to 91.8% (281/306 lines) and the first real property
   violation (GL-70) surfaced. See
   [`sablier-nft-approval-fuzz-reachability-gap.md`](../test-failures/sablier-nft-approval-fuzz-reachability-gap.md).

2. **GL-70 stream reuse after loan close**: The property
   `loan.drawn == getWithdrawnAmount - creationSnapshot` broke when a returned
   stream was re-pledged to a new loan or withdrawn externally. Fix: snapshot
   `getWithdrawnAmount` at close time. See
   [`stream-reuse-after-loan-close-property-fix.md`](../logic-errors/stream-reuse-after-loan-close-property-fix.md).

Intermediate Medusa campaign: 147 passed, 0 failed, OVRFLOLending.sol 91.8% coverage. A subsequent phase pushed coverage to 98.7% — see the second continuation below.

### Second continuation (2026-07-14): 91.8% to 98.7%

A line-by-line read of the 25 uncovered lines sorted them into four classes,
each demanding a different remedy:

1. **View functions never called.** `loanState`, `liquidityState`, and
   `saleListingState` had zero callers — no handler, no property. Fixed by
   adding properties that call the views and assert structural invariants, and
   by inserting direct view calls inside existing handlers right after the
   state they describe is created (`supplyLiquidity` calls `liquidityState`,
   `createBorrowerLoanPool` calls `loanState`, `postSaleListing` calls
   `saleListingState`). The handler calls guarantee coverage on every
   state-creating path; the properties exercise the views as first-class
   assertions.

2. **Exact-exhaustion branches.** The liquidity deactivation
   (`if (availableLiquidity == 0) { active = false; }`, line 379) and the
   `repayLoan` close path (`if (closes) { loan.closed = true; }` plus
   `sablier.transferFrom`, lines 517/524) fire only when an amount lands
   *exactly* on a boundary. Random fuzz on 18-decimal tokens almost never
   matches. Fixed with a constructed scenario (`scenario_sellExactsLiquidity`)
   that quotes the stream, posts liquidity with capacity == grossPrice, and
   sells into it to hit the deactivation branch exactly; and a clamped
   `repayLoan` handler that uses `amount % 3 == 0` to select the exact
   outstanding amount one-third of the time.

3. **Early-return guard.** `gatherLiquidity` short-circuits when
   `startId >= nextLiquidityId` (line 804). The handler always passed
   `startId = 1`, so the guard never fired. Fixed by adding a branch that
   sometimes passes `startId = nextLiquidityId + 1`.

4. **Immutable declarations (uncoverable).** Lines 47, 49, 53, 55 are
   `immutable` variable declarations — storage layout, not executable
   statements. LCOV marks them uncovered, but no test can "execute" a
   declaration. This is a Solidity LCOV tooling artifact; the practical ceiling
   is 98.7% (302/306).

Three false positives surfaced during the widened campaign, each triaged
against the source:

- **SP-100 treasury-as-actor:** `property_borrow_disbursement_conservation`
  asserts the borrower's underlying increase equals `actualBorrow - fee`. When
  the admin handler sets the treasury to an actor address and that actor is
  also the borrower, the actor receives both net disbursement and fee
  (= `actualBorrow`), breaking the assertion. Fix: gate the property on
  `lending.treasury() != actor`.
- **GL-57 ghost start-value after setup mint:** `scenario_sellExactsLiquidity`
  mints tokens via `underlying.deal()` without updating
  `ghost_actorStartValue`, triggering the no-free-profit property. Fix:
  `ghost_actorStartValue[actor] += grossPrice` after any test-only mint.
- **Handler prefix rename blind spot:** the `OVRFLOLENDING` to `OVRFLOLending`
  rename missed handler prefixes like `oVRFLOLENDING_` because the lowercase
  leading `o` means the prefix does not contain the search string as a
  substring. Fixed with a targeted replacement.

Final Medusa campaign: 151 passed, 0 failed, OVRFLOLending.sol 98.7% coverage
(302/306 lines). Forge: 362/362 passing. The four remaining lines are the
documented immutable-declaration artifact.

## Related

- [Test Quality Patterns to Avoid in Solidity/Foundry Projects](../best-practices/solidity-foundry-test-quality-antipatterns.md) - generalizes this campaign's mock-fidelity and ghost-recording patterns into a reusable catalog of 10 anti-patterns
- [Triage audit findings by trust boundary, then fix test-first and sync pattern docs](../best-practices/triage-fix-and-document-audit-findings.md) - same triage discipline applied to static audit findings rather than fuzz violations
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) - the enforceable rules (pattern #10 strictly-increasing IDs, pattern #12 pro-rata cap, pattern #11 sweepExcessPt guard) the properties encode
- The Fizz gap closure plan at `docs/plans/2026-07-05-002-feat-fizz-gap-closure-plan.md` - the read-only spec governing the 8 implementation units
- [Sablier NFT setApprovalForAll fuzz reachability gap](../test-failures/sablier-nft-approval-fuzz-reachability-gap.md) - a 13th gap discovered in a later campaign phase; same root cause (mock/harness missing a capability)
- [GL-70 stream reuse after loan close](../logic-errors/stream-reuse-after-loan-close-property-fix.md) - a 5th triage case from the same campaign; property snapshot baseline breaks under stream reuse
- [View functions revert on non-existent IDs](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md) - pattern #8, the safety contract the new view-function coverage properties validate
