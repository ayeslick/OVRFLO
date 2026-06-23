---
title: "feat: OVRFLOBook maker fee commitment and lender obligation slippage"
type: feat
date: 2026-06-23
origin: docs/brainstorms/2026-06-20-ovrflo-secondary-market-requirements.md
---

# feat: OVRFLOBook maker fee commitment and lender obligation slippage

## Summary

Close two review-stage gaps in `src/OVRFLOBook.sol`. First, snapshot `feeBps` into the two resting orders where the *maker* absorbs the fee — sale listings and borrow listings — so a later `setFee` cannot retroactively cut a resting maker's proceeds. Second, replace the inert `maxPriceIn` guard on `lendAgainstListing` with a meaningful `minObligationOut`, since the lender's only drifting variable is the obligation they receive, not the fixed price they pay.

---

## Problem Frame

The book takes a global `feeBps` at execution time. For the two order types where the resting maker bears the fee — `takeListing` (the seller/maker receives `grossPrice − fee`, `src/OVRFLOBook.sol:336`) and `lendAgainstListing` (the borrower/maker receives `borrowAmount − fee`, `src/OVRFLOBook.sol:480`) — the maker posts and walks away with no slippage parameter. If the owner raises `feeBps` before a taker fills, the maker silently nets less while the taker still pays the same gross. The two *offer* types (`hitOffer`, `borrowAgainstOffer`) are unaffected: there the taker absorbs the fee and already carries `minNetOut`.

Separately, `lendAgainstListing` takes `maxPriceIn` and checks it against `listing.borrowAmount` (`src/OVRFLOBook.sol:471`). `borrowAmount` is written once in `postBorrowListing` and never mutated, so `maxPriceIn` only bounds a value the lender already knows — it protects nothing. The lender's real exposure is the `obligation` they receive (`src/OVRFLOBook.sol:481`), which for a partial fill is `borrowAmount · factor(aprBps, timeToMaturity)` and shrinks monotonically as maturity approaches. A lender whose transaction is delayed receives strictly less obligation with nothing to stop it, while the symmetric taker path `borrowAgainstOffer` does carry `minNetOut`.

Both bounds are governed by the timelocked multisig and capped at `MAX_FEE_BPS` (1% by deploy default), so the fee exposure is bounded and slow — but a committed snapshot removes the surprise entirely, and the obligation drift is unbounded in time.

---

## Requirements

### Maker fee commitment

- R1. `listStream` records the current `feeBps` on the `SaleListing` at post time; `takeListing` computes the fee from the recorded value, not the live global.
- R2. `postBorrowListing` records the current `feeBps` on the `BorrowListing` at post time; `lendAgainstListing` computes the fee from the recorded value, not the live global.
- R3. A `setFee` change between post and fill does not alter the net proceeds of an already-resting sale listing or borrow listing.
- R4. The offer paths (`hitOffer`, `borrowAgainstOffer`) and their structs are unchanged — the taker bears the fee there and is already protected by `minNetOut`.

### Lender obligation slippage

- R5. `lendAgainstListing`'s second parameter is `minObligationOut`; the call reverts with `"OVRFLOBook: slippage"` when the computed `obligation` is below it.
- R6. `maxPriceIn` is removed from `lendAgainstListing`; no upper-bound-on-price check remains, because `borrowAmount` is fixed on the listing.
- R7. The slippage check runs against the same `obligation` value that is stored on the originated loan.

### Surface consistency

- R8. The public mapping getters and the explicit `saleListingState` / `borrowListingState` views expose the recorded `feeBps`; the `SaleListingPosted` / `BorrowListingPosted` events carry it.
- R9. `forge build` is clean and the existing `test/OVRFLOBook.t.sol` suite compiles and passes against the changed struct getters and the new `lendAgainstListing` signature.

---

## Key Technical Decisions

- Snapshot the fee only on `SaleListing` and `BorrowListing`, not on `SaleOffer` / `LendOffer`: only listings have a resting maker who bears the fee. Adding it to offers would be dead state.
- Store the snapshot as a `uint16 feeBps` field placed immediately before `active` in each struct. Both structs have a tail that leaves room in an existing storage slot (`SaleListing`: `aprBps`+`active`; `BorrowListing`: `aprBps`+`borrowAmount`+`active`), so the field is free — no new slot.
- Replace `maxPriceIn` rather than keep both guards. The brainstorm's indicative surface was `lendAgainstListing(…, maxPriceIn)` (origin §5.1), but review shows `maxPriceIn` is inert against a fixed `borrowAmount`. Keeping both would imply two protections when only one is real. `minObligationOut` is the load-bearing guard; this is a deliberate, documented deviation from the origin surface (see origin: `docs/brainstorms/2026-06-20-ovrflo-secondary-market-requirements.md`).
- Keep `takeListing`'s `maxPriceIn` as-is. There the taker pays `grossPrice`, which genuinely rises as maturity nears, so the upper bound is meaningful — unlike the `lendAgainstListing` case.
- Adding a struct field changes the auto-generated public mapping getter's return tuple. Every `book.saleListings(id)` / `book.borrowListings(id)` destructuring in tests gains one element; the explicit `*State` views and `*Posted` events are updated in lockstep so the on-chain surface stays coherent (R8).

---

## Implementation Units

### U1. Fee commitment for sale listings

- Goal: snapshot `feeBps` on `SaleListing` so `takeListing` is immune to retroactive `setFee`.
- Requirements: R1, R3, R4 (sale side), R8 (sale side).
- Dependencies: none.
- Files:
  - `src/OVRFLOBook.sol` — add `uint16 feeBps` to `struct SaleListing` (immediately before `active`); set `feeBps: feeBps` in the `listStream` struct literal; in `takeListing` compute `StreamPricing.fee(grossPrice, listing.feeBps)`; add `feeBps` to `saleListingState` returns; add `feeBps` to the `SaleListingPosted` event and its emit.
  - `test/OVRFLOBook.t.sol` — update every `book.saleListings(id)` destructuring and any `saleListingState` assertion to include the new field; add the retroactive-fee test below.
- Approach: the global `feeBps` is read at post time only. `takeListing`'s gross-price math, `maxPriceIn` check, and settlement transfers are otherwise unchanged. The taker still pays `grossPrice`; only the fee split is now sourced from the snapshot.
- Patterns to follow: mirror the existing struct-literal and `StreamPricing.fee(...)` usage already in `takeListing` (`src/OVRFLOBook.sol:324-348`); event-shape conventions from the other `*Posted` events.
- Test scenarios:
  - Happy path: post a sale listing while `feeBps = 0`, owner sets `feeBps = 100`, take the listing → seller nets `grossPrice` (old fee 0), treasury receives 0. Covers R1, R3.
  - Happy path: post while `feeBps = 100`, take without change → seller nets `grossPrice − 1%`, treasury receives 1%. Confirms the snapshot equals the live value when unchanged.
  - State exposure: `saleListings(id)` / `saleListingState(id)` return the snapshotted `feeBps`; `SaleListingPosted` carries it. Covers R8.
  - Regression: existing `takeListing` slippage (`maxPriceIn`) and dead-listing reverts still hold.
- Verification: `forge build` clean; sale-listing tests pass; a fee raised after posting does not change the taker-time seller proceeds.

### U2. Fee commitment and obligation slippage for borrow listings

- Goal: snapshot `feeBps` on `BorrowListing` and replace `lendAgainstListing`'s inert `maxPriceIn` with `minObligationOut`.
- Requirements: R2, R3 (borrow side), R5, R6, R7, R8 (borrow side).
- Dependencies: none (independent of U1, but shares the same struct-getter test pattern).
- Files:
  - `src/OVRFLOBook.sol` — add `uint16 feeBps` to `struct BorrowListing` (immediately before `active`); set `feeBps: feeBps` in the `postBorrowListing` struct literal; add `feeBps` to `BorrowListingPosted` event + emit; change `lendAgainstListing(uint256, uint128 minObligationOut)`; remove the `listing.borrowAmount <= maxPriceIn` check; compute `obligation` first, then `require(obligation >= minObligationOut, "OVRFLOBook: slippage")`; compute fee as `StreamPricing.fee(listing.borrowAmount, listing.feeBps)`; add `feeBps` to `borrowListingState` returns.
  - `test/OVRFLOBook.t.sol` — update every `book.borrowListings(id)` destructuring; fix the two `lendAgainstListing(id, <ether>)` callsites for the new `minObligationOut` semantics; rewrite the slippage sub-test; add the retroactive-fee and obligation-drift tests below.
- Approach: order of operations in `lendAgainstListing` changes so `obligation` is known before the slippage check (today the check precedes pricing). The `require(grossPrice > 0)` and `require(borrowAmount <= grossPrice)` guards remain. `minObligationOut` is a floor on what the lender receives; `0` disables it. The local variable currently named `obligation` shadows `StreamPricing.obligation`; optionally rename the local to `obligationOut` while editing (cosmetic, not required).
- Patterns to follow: the `minNetOut` slippage pattern in `borrowAgainstOffer` (`src/OVRFLOBook.sol:403`) is the symmetric precedent — a floor on the taker's economic outcome checked after pricing.
- Test scenarios:
  - Happy path: post a borrow listing while `feeBps = 0`, owner sets `feeBps = 100`, lend against it → borrower nets `borrowAmount` (old fee 0). Covers R2, R3.
  - Happy path (full fill): `borrowAmount == grossPrice` at fill → `obligation == remaining`; `minObligationOut = remaining` passes, `minObligationOut = remaining + 1` reverts `"OVRFLOBook: slippage"`. Covers R5, R7.
  - Obligation drift: post a partial-fill listing (`borrowAmount < grossPrice`), warp time forward toward maturity, then lend → recomputed `obligation` is lower; a `minObligationOut` set to the pre-warp obligation reverts. Covers R5.
  - Removal: passing a value below `borrowAmount` no longer reverts on its own (the old `maxPriceIn` semantics are gone) so long as the obligation floor is met. Covers R6.
  - State exposure: `borrowListings(id)` / `borrowListingState(id)` return the snapshotted `feeBps`; `BorrowListingPosted` carries it. Covers R8.
  - Regression: dead-listing revert (`"OVRFLOBook: borrow listing inactive"`), `borrow above price`, and `price zero` paths still hold; the originated `Loan.obligation` equals the slippage-checked value.
- Verification: `forge build` clean; borrow-listing and loan-origination tests pass; a delayed fill with a tight `minObligationOut` reverts rather than silently under-delivering.

---

## Scope Boundaries

In active scope: the fee snapshot on the two maker-bears-fee listings (R1–R4, R8) and the `minObligationOut` replacement on `lendAgainstListing` (R5–R7). Offer structs and offer-path slippage are untouched.

### Deferred to Follow-Up Work

- Minimum fill size / minimum borrow (the "dust-loan griefing" concern). Today only `> 0` floors exist. The risk is limited because every loan-creating fill must escrow a real Sablier stream NFT, which rate-limits spam; the one genuine wrinkle is `StreamPricing.obligation`'s round-up (`src/StreamPricing.sol:65-67`) being disproportionate for sub-wei-scale borrows, which is borrower self-harm rather than counterparty griefing. Add a `MIN_FILL`/`MIN_BORROW` floor only if abuse appears. Matches the project preference for minimal abstractions.
- Splitting `test/OVRFLOBook.t.sol` (1,068 lines) into per-concern files (sale offers, sale listings, lend offers, borrow listings, loan servicing) over a shared base. Pure maintainability; best done *after* this plan lands so the new tests slot into the split rather than being rebased onto churn.
- A `deadline` parameter across taker entrypoints. `minObligationOut` covers the load-bearing time-drift risk here; a uniform deadline is an API-symmetry nicety, not a correctness fix.

---

## System-Wide Impact

`OVRFLOBook` is `Ownable2Step`, owned by the timelocked multisig (`script/OVRFLOBook.s.sol:36`); `setFee` is capped at the immutable `MAX_FEE_BPS`. The contract is not yet referenced by any frontend or ABI consumer (only `src/OVRFLOBook.sol` and `test/OVRFLOBook.t.sol` reference these symbols), so the `lendAgainstListing` signature change and the struct-getter tuple change are safe to make now without coordinating downstream consumers. The deploy script does not call `lendAgainstListing` or read the listing structs, so it needs no change.

---

## Risks & Dependencies

- Struct-field addition ripples to the auto-generated public mapping getters; missing a destructuring callsite is a compile error, not a silent bug — `forge build` surfaces all of them. Low risk.
- Reordering `lendAgainstListing` so pricing precedes the slippage check must preserve the existing `grossPrice > 0` and `borrowAmount <= grossPrice` guards; the obligation floor is additive, not a replacement for those.
- No external dependency or version churn; changes are local to one contract and its test.
