---
title: OVRFLOBook pool-only lending consolidation — removing the single-party lending path
date: 2026-06-29
category: docs/solutions/architecture-patterns
module: OVRFLOBook
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Deciding whether to retain single-party lending alongside pool-based lending in OVRFLOBook"
  - "Consolidating redundant execution paths to shrink the contract surface and reduce test burden"
  - "Evaluating whether an awkward middle-ground abstraction between active sales and passive pool lending should be removed"
  - "Refactoring loan servicing (closeLoan, repayLoan) to route repayments through shared poolProceeds instead of direct loan.lender accounting"
  - "Auditing OVRFLOBook for dead code paths after a lending-mechanism consolidation"
tags: [ovrflobook, lending, pools, architecture, refactor, consolidation, loan-servicing, dead-code]
---

# OVRFLOBook pool-only lending consolidation — removing the single-party lending path

## Context

`OVRFLOBook` grew three lending-adjacent mechanisms over its evolution:

1. **Sales** (`sellIntoOffer`, `buyListing`) — active, immediate trading of a stream for underlying.
2. **Single-party lending** (`borrowAgainstOffer`, `lendAgainstListing`, `claimLoan`) — one borrower paired with one lender, repaid via direct token transfer to the lender.
3. **Pools** (`createBorrowPool`, `createLenderPool`, `poolClaimLoan`, `claimPoolShare`) — batch lending across many offers/listings with pro-rata claims against a shared `poolProceeds` pot.

The single-party path was an awkward middle ground. It duplicated the pool semantics ("a pool of one") while carrying its own entry points, its own events (`BorrowedAgainstOffer`, `LentAgainstListing`, `LoanClaimed`), its own test functions, and its own branching inside the shared loan-servicing functions. Every pool loan sets `loanPoolId[loanId] = poolId` and routes repayments through `poolProceeds`; a single-party loan left `loanPoolId` at zero and routed tokens directly to `loan.lender`. That `if (poolId != 0)` fork existed *only* to support the single-party case, and it forced every test, every invariant handler, and every fork test to maintain a parallel set of assertions. A pool created with a single offer or a single listing achieves the exact same economic outcome as single-party lending, so the separate path added surface area and test burden without adding capability.

### Historical design context (session history)

The single-party path was originally the v1 lending mechanism, with pools explicitly deferred as a "forward-compat seam" (session history, 2026-06-20 to 2026-06-23). The original plan designed a loan lifecycle around three functions: `claimLoan` (lender's optional early-access draw), `closeLoan` (permissionless liveness backstop), and `repayLoan` (borrower-only early exit, added late and generalized to partial at the user's insistence). A two-channel "satisfied" accounting model tracked `drawn` (stream draws) and `repaid` (direct token pushes) independently, with `satisfied = drawn + repaid` capping every channel at `outstanding`.

An adversarial review pass surfaced six findings against this design, including: `closeLoan` zero-amount revert (Sablier V2 reverts on `withdraw(amount=0)`, bricking the normal "lender already fully claimed" path), `claimLoan` same zero-amount revert, and CEI ordering concerns across claim/close/repay. These findings required conditional logic patches (zero-guards, always-transfer-NFT patterns) that complicated what was meant to be a simple backstop. When pools were later implemented, the single-party path became redundant, and the patches became dead complexity.

## Guidance

Consolidate on **pools as the only lending mechanism**. If a borrower wants a loan from one lender, that lender posts a lend offer and the borrower calls `createBorrowPool` with a one-element `offerIds` array. If a lender wants to fund one borrower, that borrower posts a borrow listing and the lender calls `createLenderPool` with a one-element `listingIds` array. There is no "single-party" shortcut; the general batch primitive subsumes it.

The concrete refactor removed `borrowAgainstOffer`, `lendAgainstListing`, and `claimLoan` plus their three events, then collapsed the `if (poolId != 0) { ... } else { ... }` branching in `closeLoan` and `repayLoan` to a single pool-routed path.

### `closeLoan` — before

```solidity
function closeLoan(uint256 loanId) external nonReentrant {
    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    require(!loan.closed, "OVRFLOBook: loan closed");

    uint128 outstanding = _outstanding(loan);
    uint128 withdrawable = sablier.withdrawableAmountOf(loan.streamId);
    require(withdrawable >= outstanding, "OVRFLOBook: loan not closable");

    loan.closed = true;
    uint256 poolId = loanPoolId[loanId];
    if (outstanding > 0) {
        loan.drawn += outstanding;
        if (poolId != 0) {
            sablier.withdraw(loan.streamId, address(this), outstanding);
            poolProceeds[poolId] += outstanding;
        } else {
            // single-party: pay the lender directly from the stream
            sablier.withdraw(loan.streamId, loan.lender, outstanding);
        }
    }
    sablier.transferFrom(address(this), loan.borrower, loan.streamId);

    emit LoanClosed(loanId, loan.borrower, loan.lender, outstanding);
}
```

### `closeLoan` — after

```solidity
function closeLoan(uint256 loanId) external nonReentrant {
    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    require(!loan.closed, "OVRFLOBook: loan closed");

    uint128 outstanding = _outstanding(loan);
    uint128 withdrawable = sablier.withdrawableAmountOf(loan.streamId);
    require(withdrawable >= outstanding, "OVRFLOBook: loan not closable");

    loan.closed = true;
    if (outstanding > 0) {
        loan.drawn += outstanding;
        uint256 poolId = loanPoolId[loanId];
        sablier.withdraw(loan.streamId, address(this), outstanding);
        poolProceeds[poolId] += outstanding;
    }
    sablier.transferFrom(address(this), loan.borrower, loan.streamId);

    emit LoanClosed(loanId, loan.borrower, loan.lender, outstanding);
}
```

The `poolId` lookup moves inside the `outstanding > 0` block (it is only needed there) and the `else` branch disappears entirely. Every loan now routes its drawn amount into `poolProceeds[poolId]`; the lender withdraws via `claimPoolShare`.

### `repayLoan` — before

```solidity
function repayLoan(uint256 loanId, uint128 amount) external nonReentrant {
    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    require(!loan.closed, "OVRFLOBook: loan closed");
    require(loan.borrower == msg.sender, "OVRFLOBook: not borrower");

    uint128 outstanding = _outstanding(loan);
    require(outstanding > 0, "OVRFLOBook: nothing outstanding");
    require(amount > 0, "OVRFLOBook: repay zero");
    require(amount <= outstanding, "OVRFLOBook: repay too much");

    loan.repaid += amount;
    bool closes = amount == outstanding;
    if (closes) {
        loan.closed = true;
    }

    uint256 poolId = loanPoolId[loanId];
    if (poolId != 0) {
        _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
        poolProceeds[poolId] += amount;
    } else {
        // single-party: pull repayment directly to the lender
        _pullExact(IERC20(ovrfloToken), msg.sender, loan.lender, amount);
    }
    if (closes) {
        sablier.transferFrom(address(this), loan.borrower, loan.streamId);
    }

    emit LoanRepaid(loanId, msg.sender, loan.lender, amount, closes);
}
```

### `repayLoan` — after

```solidity
function repayLoan(uint256 loanId, uint128 amount) external nonReentrant {
    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    require(!loan.closed, "OVRFLOBook: loan closed");
    require(loan.borrower == msg.sender, "OVRFLOBook: not borrower");

    uint128 outstanding = _outstanding(loan);
    require(outstanding > 0, "OVRFLOBook: nothing outstanding");
    require(amount > 0, "OVRFLOBook: repay zero");
    require(amount <= outstanding, "OVRFLOBook: repay too much");

    loan.repaid += amount;
    bool closes = amount == outstanding;
    if (closes) {
        loan.closed = true;
    }

    uint256 poolId = loanPoolId[loanId];
    _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
    poolProceeds[poolId] += amount;
    if (closes) {
        sablier.transferFrom(address(this), loan.borrower, loan.streamId);
    }

    emit LoanRepaid(loanId, msg.sender, loan.lender, amount, closes);
}
```

Repaid ovrfloToken always lands in `poolProceeds[poolId]` (the book's own balance). The lender retrieves it with `claimPoolShare(poolId, amount)`.

### Test assertion pattern change

Because tokens now accumulate in `poolProceeds` rather than reaching the lender directly, every test that previously asserted a lender balance *immediately after* `closeLoan` or `repayLoan` must insert a `claimPoolShare` call first.

**Before** (single-party — direct to lender):

```solidity
book.closeLoan(loanId);
assertEq(ovrfloToken.balanceOf(LENDER), obligation);
```

**After** (pool — route through `poolProceeds`, then claim):

```solidity
book.closeLoan(loanId);
vm.prank(BUYER);
book.claimPoolShare(poolId, 110 ether);
assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
```

Note the asymmetry with `poolClaimLoan`: that function draws *directly* from the Sablier stream to the caller (`sablier.withdraw(loan.streamId, msg.sender, drawAmount)`), so it does **not** require a follow-up `claimPoolShare`. Only `closeLoan` and `repayLoan` route into `poolProceeds` and thus need the extra claim step before a balance assertion.

## Why This Matters

- **Smaller contract surface.** Three external functions, three events, and their internal helpers are gone. The order-book contract shrank by a meaningful chunk of bytecode, which lowers deployment cost and the audit review perimeter.
- **No dead code paths.** The `if (poolId != 0) { ... } else { ... }` fork in `closeLoan` and `repayLoan` existed only to serve single-party loans. With every loan now pool-backed, `loanPoolId` is always non-zero for a live loan, so the branch collapses to a straight line. Fewer branches means fewer places for a subtle routing bug to hide.
- **Lighter test burden.** Twelve single-party test functions were deleted. The invariant harness lost three handler functions and two dead helpers. Fork tests lost four direct references. Every remaining loan test now exercises the same pool path that production uses, so coverage is concentrated rather than split across two equivalent paths.
- **Single mental model.** Lenders always claim via `claimPoolShare` (proceeds from `closeLoan`/`repayLoan`) or `poolClaimLoan` (direct stream draw). There is no third "direct to lender" path to remember. A pool with one offer and one stream is a single-party loan; the generality is free because the batch primitive already had to handle the `n = 1` case correctly.
- **Invariant integrity.** With one lending path, invariant handlers can focus on the pool claim channels without maintaining a parallel single-party claim handler that must track the same invariants.
- **Eliminates patches for fragile edge cases.** The single-party path required zero-amount guards in `closeLoan` (Sablier V2 reverts on `withdraw(amount=0)`) and careful CEI ordering across three functions (session history). The pool path inherits the same guards but the branching complexity that motivated them is gone.

## When to Apply

Apply this when a contract has two or more mechanisms that overlap in functionality and one is **strictly more general** than the other — i.e., the general mechanism already handles the degenerate (single-element) case of the specific one with no extra cost to the caller beyond passing a one-element array. The signal is a shared servicing function that forks on a flag or sentinel (`if (poolId != 0)`, `if (isSingle)`, etc.) purely to support the narrower path. If removing the narrower path leaves the general path's `n = 1` case behaviorally identical, the narrower path is dead weight.

Do **not** apply this reflexively when the narrower path offers something the general path cannot (e.g., a cheaper gas path that avoids batch bookkeeping, or a different trust model). Here the pool's single-offer case had identical gas and identical semantics, so consolidation was pure win.

## Examples

### 1. `closeLoan` branching collapse

The `if (poolId != 0) { pool path } else { direct to lender }` fork becomes a single pool path. See the before/after blocks in **Guidance** above. The `else` branch (drawing directly to `loan.lender`) is removed; `poolProceeds[poolId]` is the only destination.

### 2. Test assertion: add `claimPoolShare` before balance check

A representative test from `test/OVRFLOBook.t.sol`:

```solidity
function test_CloseLoan_RevertsUntilClosableThenPaysAndReturnsNft() public {
    (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(20, 100 ether);

    sablier.setWithdrawable(20, 109 ether);
    vm.expectRevert("OVRFLOBook: loan not closable");
    book.closeLoan(loanId);

    sablier.setWithdrawable(20, 110 ether);
    vm.prank(STRANGER);
    book.closeLoan(loanId);

    (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
    assertEq(drawn, 110 ether);
    assertTrue(closed);
    vm.prank(BUYER);
    book.claimPoolShare(poolId, 110 ether);          // <-- new step
    assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
    assertEq(sablier.getWithdrawnAmount(20), 110 ether);
    assertEq(sablier.ownerOf(20), SELLER);
}
```

Without the `claimPoolShare` call, `ovrfloToken.balanceOf(BUYER)` would still be `0` because the 110 ether sits in `poolProceeds[poolId]` (the book's balance), not the lender's wallet.

### 3. Helper rewrite: `_originateLoanViaOffer` to `_originateLoanViaBorrowPool`

**Before** (single-party origination):

```solidity
function _originateLoanViaOffer(uint256 streamId, uint128 borrowAmount)
    internal
    returns (uint256 loanId)
{
    uint256 offerId = _postLendOffer(LENDER, borrowAmount);
    _mintEligibleStream(streamId, BORROWER, 110 ether, 0);
    vm.startPrank(BORROWER);
    sablier.approve(address(book), streamId);
    loanId = book.borrowAgainstOffer(offerId, streamId, borrowAmount);
    vm.stopPrank();
}
```

**After** (pool origination, returns `(poolId, loanId)`):

```solidity
function _originateLoanViaBorrowPool(uint256 streamId, uint128 borrowAmount)
    internal
    returns (uint256 poolId, uint256 loanId)
{
    uint256 offerId = _postLendOffer(BUYER, borrowAmount);
    _mintEligibleStream(streamId, SELLER, 110 ether, 0);
    loanId = book.nextLoanId();
    vm.startPrank(SELLER);
    sablier.approve(address(book), streamId);
    uint256[] memory offerIds = new uint256[](1);
    offerIds[0] = offerId;
    poolId = book.createBorrowPool(offerIds, streamId, borrowAmount, 0);
    vm.stopPrank();
}
```

The return signature widens to `(poolId, loanId)` because downstream tests need `poolId` to call `claimPoolShare`. `loanId` is captured *before* `createBorrowPool` via `book.nextLoanId()` (strictly-increasing IDs, pattern #11) since the pool function returns `poolId`, not `loanId`.

## Related

- `docs/solutions/patterns/ovrflo-critical-patterns.md` — pattern #4 (self-match prevention) applies unchanged to `createBorrowPool`; the single-party self-match case is gone.
- `docs/solutions/architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md` — entry-point teardown pattern: when removing a mechanism, audit every caller, helper, and assertion that touched it so zero stale references remain.
- `docs/solutions/architecture-patterns/ovrflobook-offer-market-active-gate.md` — eligibility gating; the market-active / requireEligible split is preserved on the pool path (offers are market-gated at post time, full stream validation runs inside `createBorrowPool`).
- `docs/solutions/design-patterns/solidity-batch-function-safety-patterns.md` — documents the pool primitives that are now the sole lending mechanism.
- `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md` — rounding invariants for `repayLoan`/`closeLoan` closure math; still applies to the simplified pool-only path.
