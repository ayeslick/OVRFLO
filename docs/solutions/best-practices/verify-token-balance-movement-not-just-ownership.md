---
title: Non-fork tests must verify token balance movement, not just ownership/NFT/state checks
category: best-practices
module: test/OVRFLOBook.t.sol
date: 2026-06-27
problem_type: best_practice
component: testing_framework
severity: low
applies_when:
  - "Writing or reviewing non-fork tests for OVRFLOBook that exercise offers, listings, loans, or any flow that moves underlying or ovrfloToken between parties"
  - "A test checks stream ownership (sablier.ownerOf), loan state, or capacity but skips verifying the actual token balance deltas for seller, buyer, treasury, and the contract"
  - "Deciding what to assert after a book operation to prove money moved correctly rather than only that an entry changed hands"
tags: [testing, foundry, assertions, token-balances, money-movement, ovrflobook, non-fork-tests, sablier]
---

# Non-fork tests must verify token balance movement, not just ownership/NFT/state checks

## Context

`OVRFLOBook` is a value-routing contract: every entry function pulls underlying
from one party, pays net to another, routes a fee to the treasury, and either
escrows or releases a Sablier stream NFT. The non-fork test suite (240 tests
across all non-fork files, with `test/OVRFLOBook.t.sol` as the primary file)
covered the control flow well, but a review surfaced a systematic blind spot:
the tests asserted **state flags and NFT ownership** without asserting the
**token balances** that those state transitions are supposed to produce.

A representative case, `test_HitOffer_PricesFromRemainingAfterPriorWithdrawals`,
confirmed that the sale offer's `capacity` dropped to `0` and that
`sablier.ownerOf(28)` moved to `BUYER`, but it never checked
`underlying.balanceOf(address(book))`, `underlying.balanceOf(TREASURY)`, or
`underlying.balanceOf(BUYER)`. In other words, the test proved the offer was
*consumed* and the stream was *transferred*, but not that the underlying
*left the book*, that the *fee was paid*, or that the upfront-liquidity provider
ended up at zero. The same shape recurred across `sellIntoOffer`, `buyListing`,
`createBorrowPool`, `createLenderPool`, and the loan-servicing paths
(`claimPoolShare`, `closeLoan`, `repayLoan`).

The friction this created: a future refactor that breaks `_payUnderlying` (wrong
payee, skipped fee, value stranded in the book, double-pay) would pass every
flag and ownership assertion in the suite and ship a fund-loss bug. State flags
and NFT ownership are necessary but not sufficient evidence that value routed
correctly, and value routing is the entire reason this contract exists.

## Guidance

For every test that exercises a function which moves tokens, assert the balance
of **every address whose balance should have changed**, plus the contract
holding the funds and the fee recipient. Treat the four-party balance check as
the core invariant of a money-movement test.

Per-flow checklist (all amounts are `underlying` unless noted):

- **`sellIntoOffer` (sale offer fill):**
  - seller received net underlying (`grossPrice - fee`)
  - treasury received the fee
  - book balance == remaining capacity (`0` if the offer was fully consumed)
  - buyer (offer maker) balance == `0` (they posted liquidity upfront)

- **`buyListing` (sale listing fill):**
  - seller received net underlying
  - treasury received the fee
  - book balance == `0` (all pulled underlying was paid out)
  - buyer balance == `0` (they paid `grossPrice`)

- **`createBorrowPool` (borrower pool — lend offer fill):**
  - borrower received net underlying
  - treasury received the fee
  - book balance == remaining capacity

- **`createLenderPool` (lender pool — borrow listing fill):**
  - borrower received net underlying
  - treasury received the fee
  - buyer (lender) balance == `0` (they paid `borrowAmount`)
  - book balance == `0` (all paid out)

- **`claimPoolShare` / `closeLoan` / `repayLoan` (loan servicing):**
  - `ovrfloToken.balanceOf` for the lender reflects accumulated draws (and
    repayments, where applicable)
  - `sablier.getWithdrawnAmount` reflects the total withdrawn from the stream
  - `sablier.ownerOf` confirms the stream is still escrowed by the book or has
    been returned to its owner
  - for `repayLoan`, `ovrfloToken.balanceOf` for the borrower decreased by the
    repaid amount

Rule of thumb: after any action that transfers an ERC-20 or ERC-721, assert the
balance of every party that touched value, the contract holding the funds, and
the fee recipient. A test that checks only the "happy path" actor's balance
leaves every other leg unverified. Where the moved quantity is an ovrfloToken or
a Sablier stream rather than underlying, assert `ovrfloToken.balanceOf`,
`sablier.getWithdrawnAmount`, and `sablier.ownerOf` accordingly.

## Why This Matters

The highest-severity bug class in `OVRFLOBook` is a misrouted payment: value
sent to the wrong address, a fee skipped or double-charged, or funds stranded in
the contract after an entry is torn down. None of those are caught by
`capacity == 0`, `active == false`, or `sablier.ownerOf(...) == X`:

- `capacity == 0` proves the offer was consumed; it does not prove the
  underlying left the book.
- `sablier.ownerOf(28) == BUYER` proves the stream was transferred; it does not
  prove the seller was paid.
- `loan.closed == true` proves the loan was closed; it does not prove the lender
  was made whole.

Balance assertions are the on-chain expression of the properties the project
already follows from the ethskills.com testing guidance: "Test properties: after
deposit and withdraw, user gets their tokens back. Test invariants: total
deposits always equals contract balance." They also directly cover the areas
that guidance says to focus testing effort on: custom business logic,
mathematical operations, integration points with external protocols (Sablier,
Pendle), access-control boundaries, and economic edge cases.

Because the non-fork suite runs in seconds, the cost of the extra `assertEq`
lines is negligible; the cost of an undetected misrouted payment is a fund-loss
or theft bug shipped to mainnet. Adding the assertions to ~15 tests took the
suite from "control flow is correct" to "value routing is correct" with no
measurable runtime cost, and all 240 non-fork tests still pass.

## When to Apply

- Any non-fork **or** fork test that calls a function transferring `underlying`,
  `ovrfloToken`, or a Sablier stream NFT.
- New tests written for `OVRFLOBook` entry/teardown functions: `sellIntoOffer`,
  `buyListing`, `createBorrowPool`, `createLenderPool`, the `cancel*`
  functions, and `claimPoolShare` / `closeLoan` / `repayLoan`.
- During test PR review: if a balance assertion is missing for a party that
  touched value, request it before approving. The four-party check (actor,
  counterparty, treasury, book) is the minimum, not a nice-to-have.
- On revert paths that expect no state change, asserting that all balances are
  unchanged is a cheap and worth-keeping invariant.
- Skip only for pure view-function tests or tests that assert nothing but event
  emission, where no value moves.

## Examples

### `sellIntoOffer` — complete the four-party check

`test_HitOffer_PricesFromRemainingAfterPriorWithdrawals` checked the offer
capacity and the stream NFT but left three balance legs unverified:

```solidity
// BEFORE (incomplete): proves the offer was consumed and the stream moved,
// not that the underlying left the book, the fee was paid, or the buyer
// (who posted liquidity upfront) is back to zero.
(,,, uint128 capacity,) = book.saleOffers(offerId);
assertEq(capacity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(sablier.ownerOf(28), BUYER);
```

```solidity
// AFTER (complete): every party that touched value is checked.
(,,, uint128 capacity,) = book.saleOffers(offerId);
assertEq(capacity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(underlying.balanceOf(TREASURY), 0);
assertEq(underlying.balanceOf(address(book)), 0);
assertEq(underlying.balanceOf(BUYER), 0);
assertEq(sablier.ownerOf(28), BUYER);
```

Here the fee is `0` (fee disabled for this case), so `TREASURY == 0`; the book
fully consumed the offer so its balance is `0`; the buyer posted the offer
upfront and is paid out, so they end at `0`. The seller keeps their `100 ether`
net. A refactor that stranded underlying in the book, paid the buyer twice, or
routed the fee to the wrong address now fails this test.

### `createLenderPool` — add the buyer and book legs

`test_CreateLenderPool_SufficientCapacity` verified the loan struct, the stream
escrow, and the seller/treasury split, but omitted the lender (buyer) and the
book:

```solidity
// BEFORE (missing buyer and book balances): proves the loan originated and
// the seller/treasury split, not that the lender paid in and the book paid
// everything out.
assertEq(sablier.ownerOf(15), address(book));
assertEq(underlying.balanceOf(SELLER), 99 ether);
assertEq(underlying.balanceOf(TREASURY), 1 ether);
```

```solidity
// AFTER (all parties checked): the lender is back to 0 (paid borrowAmount)
// and the book holds nothing (all pulled underlying was paid out).
assertEq(sablier.ownerOf(15), address(book));
assertEq(underlying.balanceOf(SELLER), 99 ether);
assertEq(underlying.balanceOf(TREASURY), 1 ether);
assertEq(underlying.balanceOf(BUYER), 0);
assertEq(underlying.balanceOf(address(book)), 0);
```

With a 1% fee on a `100 ether` borrow, the seller receives `99 ether`, the
treasury receives `1 ether`, the lender's `100 ether` is gone, and the book
retains `0`. The two added lines turn "the loan struct looks right" into "the
money actually moved to the right places."

## Related

- `test/OVRFLOBook.t.sol` — the ~15 tests updated with full balance assertions
  (`sellIntoOffer`, `buyListing`, `createBorrowPool`, `createLenderPool`,
  `claimPoolShare`, `closeLoan`, `repayLoan` paths).
- `src/OVRFLOBook.sol` — the entry/teardown and loan-servicing functions whose
  value routing these assertions guard (`_payUnderlying`, `_pullExact`, and the
  per-flow payout logic).
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from the solutions knowledge base.
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)
  — companion note on which struct fields to zero on teardown; the balance
  assertions here verify the *funds* side of that teardown.
- ethskills.com testing guidance — "Test properties: after deposit and withdraw,
  user gets their tokens back. Test invariants: total deposits always equals
  contract balance," and the focus areas (custom business logic, math,
  integration points, access control, economic edge cases).
