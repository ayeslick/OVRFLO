---
title: "OVRFLOBook Pool - Plan"
type: feat
date: 2026-06-29
topic: ovrflobook-pool
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

Add a pool primitive to `OVRFLOBook` that lets a borrower aggregate multiple lend offers into one loan, or a lender aggregate multiple borrow listings into one batch deployment, executed atomically in a single transaction. Participants claim pro-rata proceeds by address, not NFTs.

**Authority hierarchy:** AGENTS.md ("favor simplicity and minimal abstractions") > ethskills SKILL.md > this plan.

**Stop conditions:** All 7 implementation units complete, `forge build` passes, `forge test` passes with 0 failures, all 6 acceptance examples verified, all-party balance assertions present on every pool creation and claim test.

---

## Product Contract

Product Contract changed: R7, R14-R16, R17-R19 updated to reflect planning decisions (separate `loanPoolId` mapping instead of Loan struct field; single `poolReceived` tracking variable instead of separate `poolDrawn`/`poolClaimed`; direct-to-caller proceeds via `poolClaimLoan`). Changes confirmed by user during scoping synthesis.

### Summary

Add borrower pools (batch `borrowAgainstOffer`) and lender pools (batch `lendAgainstListing`) to `OVRFLOBook`, with address-based pro-rata claims. Enforce whole-number interest rates (0-99% in 1% steps) across all offers and listings. Provide on-chain `gatherCapacities` view functions so the protocol is not dependent on off-chain indexing.

### Problem Frame

A lender with $1M to deploy has no single stream large enough to absorb it, so they must call `lendAgainstListing` repeatedly across multiple listings, paying gas per call and managing each loan individually. A borrower wanting $1M faces the same problem in reverse -- no single lend offer has enough capacity, so they call `borrowAgainstOffer` multiple times, but a stream NFT can only be escrowed once, so they cannot borrow against the same stream from multiple offers today. The pool removes both bottlenecks by aggregating offers or listings in one transaction with one claim point.

### Key Decisions

**Built into OVRFLOBook, not a separate contract.** The pool reuses the book's existing state, mappings, and loan servicing logic. No new deployment or proxy.

**Lend/borrow side only.** Sales are one-and-done (NFT transfer, no ongoing relationship). Pools are for loans, which have ongoing servicing.

**Pool as virtual lender.** Pool loans set `loan.lender = address(book)`. The existing `closeLoan` (permissionless) and `repayLoan` (borrower-initiated) auto-route ovrfloToken to `poolProceeds[poolId]`. `claimLoan` reverts for pool loans; `poolClaimLoan` replaces it with direct-to-caller draws. Non-pool loans are unaffected.

**Explicit IDs, no linked list.** The caller passes offer/listing IDs directly. No on-chain index to maintain on post or cancel. Cancellation stays as-is (`active = false`).

**On-chain gatherCapacities for resilience.** View function scans offers by `(market, aprBps)`, checks `marketActive` (deadline gate), accumulates until target is met, returns matching IDs. The protocol is not dependent on off-chain infrastructure.

**Whole-number rates everywhere.** `APR_STEP_BPS = 100` constant, `aprBps % APR_STEP_BPS == 0` added to `_validateApr`. Applies to all offers and listings, not just pools. Valid rates: 0, 100, 200, ..., 9900 bps (0% to 99%).

**Partial claims with entitlement cap.** `claimPoolShare(poolId, amount)` lets participants claim any amount up to their available share. A single `poolReceived` tracking variable caps total received across both claim channels (direct draw + pool proceeds) at the lender's pro-rata entitlement.

### Requirements

**Rate Constraint**

- R1. All offers and listings must use whole-number APR (multiples of `APR_STEP_BPS = 100` bps). `_validateApr` enforces this alongside existing bounds.
- R2. The step size is a named constant, not a magic number.

**Gather Functions**

- R3. `gatherLendCapacities(market, aprBps, targetAmount, startId)` returns matching lend offer IDs where `active`, `capacity > 0`, `market` and `aprBps` match, and the series is not matured. Stops when accumulated capacity meets `targetAmount`. Returns `(uint256[] ids, bool sufficient)`.
- R4. `gatherBorrowListings(market, aprBps, targetAmount, startId)` returns matching borrow listing IDs using the same filtering and accumulation logic. Returns `(uint256[] ids, bool sufficient)`.
- R5. Both gather functions call `StreamPricing.marketActive` before scanning to gate out expired series.

**Borrower Pool (batch borrowAgainstOffer)**

- R6. `createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable)` consumes capacity from multiple lend offers, creates a single loan with the borrower's stream, and records each offer maker's contribution. Reverts if total available capacity is below `minAcceptable`.
- R7. The pool is the virtual lender on the loan (`loan.lender = address(book)`, `loanPoolId[loanId] = poolId`). A separate `mapping(uint256 => uint256) loanPoolId` tracks pool membership (0 = non-pool) without modifying the Loan struct.
- R8. The borrower receives `totalBorrowed - totalFees` in underlying. Each offer maker's consumed capacity is recorded in `poolContributions[poolId][lender]`.
- R9. Fees are charged per-fill, same as `borrowAgainstOffer`, routed to treasury.

**Lender Pool (batch lendAgainstListing)**

- R10. `createLenderPool(listingIds, totalAmount, minAcceptable)` creates a loan against each borrow listing, deploying the lender's capital across multiple streams. Reverts if total available borrow amount is below `minAcceptable`.
- R11. Each loan has `loan.lender = address(book)` and `loanPoolId[loanId] = poolId`. The lender's total deployed amount is recorded in `poolContributions[poolId][lender]`.
- R12. Fees are charged per-fill, same as `lendAgainstListing`, routed to treasury.
- R13. Unused capital (if total listings < `totalAmount`) is returned to the lender.

**Pool Claims**

- R14. `claimPoolShare(poolId, amount)` sends `amount` ovrfloToken to the caller from `poolProceeds[poolId]`, up to their available share. Available = `min(poolProceeds[poolId], entitlement - poolReceived[poolId][caller])` where entitlement = `poolContributions * obligation / poolTotalContributed`. Updates `poolReceived` to prevent over-claiming.
- R15. `poolClaimLoan(poolId, loanId, amount)` lets any pool contributor actively draw from a specific loan's Sablier stream. OvrfloToken goes directly to the caller (not to `poolProceeds`), avoiding the commons problem. Capped by remaining entitlement and stream claimable amount.
- R16. A single `poolReceived[poolId][caller]` tracking variable caps total received across both channels (direct draw + pool proceeds) at the lender's pro-rata entitlement. No separate `poolDrawn`/`poolClaimed` mappings needed.

**Loan Servicing Integration**

- R17. `closeLoan` and `repayLoan` route ovrfloToken to `poolProceeds[poolId]` when `loanPoolId[loanId] != 0`. Non-pool loans transfer directly to `loan.lender` as today.
- R18. `claimLoan` reverts for pool loans (`loanPoolId[loanId] != 0`); use `poolClaimLoan` instead.
- R19. A separate `mapping(uint256 => uint256) public loanPoolId` tracks which pool a loan belongs to (0 = non-pool). The Loan struct is not modified, avoiding changes to the return arity of the public `loans()` accessor and existing test destructuring.

**Pool Struct**

- R20. A `Pool` struct tracks `creator`, `market`, `aprBps`, `totalContributed`, `isLend` (true = lender pool, false = borrower pool), and `active` (false when all loans settled and proceeds claimed).

### Key Flows

- F1. Borrower pool creation
  - **Trigger:** Borrower wants a large loan but no single lend offer has enough capacity.
  - **Actors:** Borrower (caller), multiple lenders (offer makers), treasury.
  - **Steps:** Borrower calls `gatherLendCapacities` to find matching offers. Passes returned IDs + streamId + target/min to `createBorrowPool`. The pool validates each offer, consumes capacity, creates one loan with the stream escrowed, transfers underlying (minus fees) to the borrower. Each lender's contribution is recorded.
  - **Outcome:** One loan exists with the pool as virtual lender. Borrower has capital. Lenders claim pro-rata as the loan is serviced.

- F2. Lender pool creation
  - **Trigger:** Lender wants to deploy capital but no single borrow listing is large enough.
  - **Actors:** Lender (caller), multiple borrowers (listing makers), treasury.
  - **Steps:** Lender calls `gatherBorrowListings` to find matching listings. Passes returned IDs + totalAmount + min to `createLenderPool`. The pool validates each listing, creates a loan per listing with that listing's stream escrowed, transfers underlying (minus fees) to each borrower. The lender's total deployment is recorded. Unused capital returned.
  - **Outcome:** Multiple loans exist, each with the pool as virtual lender. Lender claims accumulated proceeds from the pool as loans are serviced.

- F3. Pool claim (two channels)
  - **Trigger:** A pool participant wants to withdraw accrued value.
  - **Actors:** Pool participant (caller).
  - **Steps:** Caller can use two channels: (a) `poolClaimLoan(poolId, loanId, amount)` draws from a specific loan's Sablier stream, ovrfloToken goes directly to caller. (b) `claimPoolShare(poolId, amount)` claims from `poolProceeds` (accumulated from closeLoan/repayLoan). Both update `poolReceived`; total capped at pro-rata entitlement.
  - **Outcome:** Participant receives ovrfloToken. Total received across both channels cannot exceed entitlement.

- F4. Pool loan servicing (auto-route)
  - **Trigger:** `closeLoan` or `repayLoan` is called on a pool loan.
  - **Actors:** Any caller (closeLoan is permissionless) or borrower (repayLoan).
  - **Steps:** The servicing function detects `loanPoolId[loanId] != 0`. Instead of transferring ovrfloToken to `loan.lender`, it credits `poolProceeds[poolId]`. The stream is returned to the borrower on close, same as today.
  - **Outcome:** Proceeds accumulate in the pool. Participants can claim via `claimPoolShare`.

### Acceptance Examples

- AE1. Insufficient capacity
  - **Covers R6, R10.**
  - **Given:** Borrower calls `createBorrowPool` with `minAcceptable = 900k` but only `800k` of capacity exists across the provided offer IDs.
  - **When:** The function executes.
  - **Then:** It reverts with "insufficient capacity" (or similar). No offers are consumed. No loan is created.

- AE2. Partial coverage succeeds
  - **Covers R6, R10.**
  - **Given:** Borrower calls `createBorrowPool` with `targetBorrow = 1M`, `minAcceptable = 700k`, and only `800k` of capacity exists.
  - **When:** The function executes.
  - **Then:** It succeeds. The borrower receives `800k - fees`. Each offer maker's consumed capacity is recorded. The loan obligation is based on `800k`, not `1M`.

- AE3. Pro-rata claim
  - **Covers R14, R16.**
  - **Given:** Borrower pool with two lenders: Alice contributed 60%, Bob contributed 40%. `poolProceeds = 100 ovrfloToken`.
  - **When:** Alice calls `claimPoolShare(poolId, 50)`.
  - **Then:** Alice receives 50 ovrfloToken. `poolReceived[poolId][Alice] = 50`. Bob's available share is still 40 (unchanged).

- AE4. Over-claim prevented
  - **Covers R14, R16.**
  - **Given:** Lender contributed 30% of a pool. `poolProceeds = 100`. Available share = 30.
  - **When:** Lender calls `claimPoolShare(poolId, 50)`.
  - **Then:** It reverts. 50 exceeds the available share of 30.

- AE5. Non-pool loan unaffected
  - **Covers R17, R18, R19.**
  - **Given:** A regular (non-pool) loan created via `borrowAgainstOffer` with `loanPoolId[loanId] = 0`.
  - **When:** `closeLoan` is called.
  - **Then:** ovrfloToken transfers directly to `loan.lender` (the external lender address). `poolProceeds` is not touched.

- AE6. Whole-number rate rejection
  - **Covers R1, R2.**
  - **Given:** A user posts a lend offer with `aprBps = 550` (5.5%).
  - **When:** `_validateApr` runs.
  - **Then:** It reverts with "apr not whole". Only `aprBps = 500` (5%) or `600` (6%) would pass.

### Scope Boundaries

- Pools are lend/borrow side only. No sale-side pools (sales are one-and-done, no ongoing relationship).
- No pool-level NFTs. Claims are address-based via internal mappings.
- No linked-list or on-chain index for offer lookup. The caller provides IDs explicitly.
- No pagination cursor on gather functions. The caller passes a `startId` to begin scanning.
- Existing one-to-one functions (`borrowAgainstOffer`, `lendAgainstListing`) remain unchanged and work alongside pools.
- No partial fills on borrow listings. Each listing is fully funded or skipped.
- No pool cancellation mechanism. Pools settle naturally as loans are serviced.

---

## Planning Contract

### Key Technical Decisions

**KTD1: Separate `loanPoolId` mapping instead of modifying Loan struct.** Adding a field to the Loan struct would change the return arity of the public `loans()` mapping accessor from 7 to 8 values, breaking every existing test that destructures the return. A separate `mapping(uint256 => uint256) public loanPoolId` avoids this entirely (0 sentinel = non-pool). Trade-off: one extra SLOAD on servicing functions to check pool membership. Chosen for zero test breakage and cleaner separation.

**KTD2: Single `poolReceived` tracking variable.** Instead of separate `poolDrawn` and `poolClaimed` mappings, one `poolReceived[poolId][lender]` tracks total received across both claim channels. Entitlement = `poolContributions * obligation / poolTotalContributed`. Total received capped at entitlement. `claimPoolShare` available = `min(poolProceeds, entitlement - poolReceived)`. `poolClaimLoan` available = `min(streamClaimable, entitlement - poolReceived)`. First-come-first-served from `poolProceeds`, but everyone's total is capped. Chosen for simplicity and user preference.

**KTD3: `poolClaimLoan` callable by any pool contributor.** Each contributor can only draw their own share (capped by entitlement), so there is no security risk. For borrower pools, this lets any lender trigger partial draws from the stream. For lender pools (one contributor), this is effectively creator-only. Chosen for simplicity and to preserve partial-draw capability for borrower pools.

**KTD4: Direct-to-caller proceeds via `poolClaimLoan`.** When a lender calls `poolClaimLoan`, ovrfloToken goes directly to them, not to `poolProceeds`. This avoids the commons problem where one lender pays gas and others free-ride. `closeLoan` and `repayLoan` still route to `poolProceeds` because the caller may not be a contributor. Chosen for user's security and fairness concern.

**KTD5: Self-match prevention generalized for pools.** In `createBorrowPool`, the borrower (`msg.sender`) must not be any of the offer makers whose offers are consumed. Check `offer.maker != msg.sender` for each offer ID. Generalizes the existing `require(msg.sender != offer.lender)` check from `borrowAgainstOffer`.

**KTD6: Gather functions use assembly to trim arrays.** Single-loop scan, allocate max-size array, fill in one pass, trim to actual count via `assembly { mstore(ids, count) }`. View function so no gas cost to caller. Avoids two-pass scanning.

**KTD7: No pool cancellation mechanism.** Pools settle naturally: `closeLoan` is permissionless (anyone can close when stream covers obligation), `repayLoan` is borrower-initiated, `poolClaimLoan` is contributor-initiated. No need for a separate cancel function.

### Assumptions

- The existing `borrowAgainstOffer` and `lendAgainstListing` logic can be factored into internal helpers reusable by the pool creation functions.
- `poolProceeds` tracks ovrfloToken held by the book on behalf of a pool. The book's ovrfloToken balance will always be >= sum of all `poolProceeds` values (invariant to test).
- Borrow listings in a lender pool are fully funded (no partial fills). Each listing's `borrowAmount` is either fully deployed or the listing is skipped.
- The `poolReceived` first-come-first-served model from `poolProceeds` is acceptable: once `closeLoan` fires, the full remaining obligation flows in, and all contributors can claim their full entitlement. Temporary imbalance only exists between `repayLoan` events and `closeLoan`.

---

## Implementation Units

### U1. Whole-number rate constraint

**Goal:** Enforce whole-number APR (multiples of 100 bps) on all offers and listings.

**Requirements:** R1, R2. Covers AE6.

**Dependencies:** None.

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** Add `uint16 public constant APR_STEP_BPS = 100;` to the constants section. Add `require(aprBps % APR_STEP_BPS == 0, "OVRFLOBook: apr not whole");` to `_validateApr`, after the existing bounds check. The constant sits alongside `LAUNCH_APR_BPS` and `APR_MAX_CEILING`.

**Patterns to follow:** Existing `_validateApr` pattern at `src/OVRFLOBook.sol` -- single bounds check, revert with descriptive message. Constant naming convention matches `APR_MAX_CEILING`.

**Test scenarios:**
- Post lend offer with `aprBps = 500` (5%) -- succeeds.
- Post lend offer with `aprBps = 550` (5.5%) -- reverts "apr not whole". Covers AE6.
- Post lend offer with `aprBps = 0` (0%) -- succeeds.
- Post lend offer with `aprBps = 9900` (99%) -- succeeds.
- Post borrow listing with `aprBps = 550` -- reverts "apr not whole".
- Existing tests using `aprBps = 1000` (10%) -- still pass.
- Post sale offer with `aprBps = 333` -- reverts "apr not whole".

**Verification:** `forge build` passes. `forge test --match-test "apr"` passes. All existing non-fork tests pass.

---

### U2. Pool data structures

**Goal:** Add Pool struct, mappings, counter, and loanPoolId mapping.

**Requirements:** R20 (partial), supports R7, R11, R14, R16, R17, R18, R19.

**Dependencies:** None (foundational, all subsequent units depend on this).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** Add the following to the storage section:

- `Pool` struct: `creator` (address), `market` (address), `aprBps` (uint16), `totalContributed` (uint128), `isLend` (bool), `active` (bool). Packed into 3 storage slots: slot 1 = creator + aprBps + isLend + active (24B), slot 2 = market (20B + 12B padding), slot 3 = totalContributed (16B + 16B padding).
- `mapping(uint256 => Pool) public pools` -- poolId => Pool.
- `mapping(uint256 => mapping(address => uint128)) public poolContributions` -- poolId => contributor => amount.
- `mapping(uint256 => uint128) public poolProceeds` -- poolId => accumulated ovrfloToken from closeLoan/repayLoan.
- `mapping(uint256 => mapping(address => uint128)) public poolReceived` -- poolId => contributor => total received across both channels.
- `mapping(uint256 => uint256) public loanPoolId` -- loanId => poolId (0 = non-pool).
- `uint256 public nextPoolId = 1` -- monotonic counter alongside existing ID counters.
- Events: `PoolCreated(uint256 indexed poolId, address indexed creator, address market, uint16 aprBps, bool isLend, uint128 totalContributed)`, `PoolShareClaimed(uint256 indexed poolId, address indexed claimant, uint128 amount)`, `PoolLoanClaimed(uint256 indexed poolId, address indexed claimant, uint256 indexed loanId, uint128 amount)`.

**Patterns to follow:** Existing struct/mapping patterns in `src/OVRFLOBook.sol` -- structs with NatSpec comments, mappings with `@notice` descriptions, ID counters starting at 1, events with indexed parameters.

**Test scenarios:**
- `nextPoolId` starts at 1.
- `loanPoolId` defaults to 0 for all existing loans (no migration needed).
- Pool struct fields are readable after creation (verified in U5/U6 tests).

**Verification:** `forge build` passes. Existing tests pass (no behavioral change, only new state variables).

---

### U3. Loan servicing integration

**Goal:** Modify `closeLoan`, `repayLoan`, and `claimLoan` to handle pool loans via `loanPoolId` check.

**Requirements:** R17, R18, R19. Covers AE5.

**Dependencies:** U2 (needs `loanPoolId` mapping and `poolProceeds`).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** In each servicing function, add a pool-routing branch:

- `closeLoan`: After drawing from the stream, check `loanPoolId[loanId]`. If non-zero, credit `poolProceeds[poolId] += drawnAmount` instead of `sablier.withdraw(streamId, loan.lender, drawnAmount)`. The withdraw target becomes `address(this)`. Non-pool loans use the existing path (`sablier.withdraw(streamId, loan.lender, drawnAmount)`).
- `repayLoan`: After pulling ovrfloToken from the borrower, check `loanPoolId[loanId]`. If non-zero, pull to `address(this)` and credit `poolProceeds[poolId] += amount`. Non-pool loans pull to `loan.lender` as today.
- `claimLoan`: Add `require(loanPoolId[loanId] == 0, "OVRFLOBook: use poolClaimLoan")` at the top. Pool loans must use `poolClaimLoan` (added in U7).

**Patterns to follow:** Existing `closeLoan`/`repayLoan`/`claimLoan` patterns. The pool routing is a simple if-else branch on `loanPoolId[loanId] != 0`. Follow the existing CEI pattern (state update before external calls).

**Test scenarios:**
- Non-pool loan `closeLoan` -- ovrfloToken transfers to `loan.lender`, `poolProceeds` untouched. Covers AE5.
- Non-pork loan `repayLoan` -- ovrfloToken transfers to `loan.lender`, `poolProceeds` untouched.
- Non-pool loan `claimLoan` -- works as before.
- Pool loan `closeLoan` -- ovrfloToken credits `poolProceeds[poolId]`, stream returned to borrower.
- Pool loan `repayLoan` -- ovrfloToken credits `poolProceeds[poolId]`.
- Pool loan `claimLoan` -- reverts "use poolClaimLoan".
- All-party balance assertions on each scenario (borrower, lender, treasury, book balances verified).

**Verification:** `forge build` passes. `forge test` passes with 0 failures. All existing loan servicing tests still pass (non-pool path unchanged).

---

### U4. Gather functions

**Goal:** Add `gatherLendCapacities` and `gatherBorrowListings` view functions.

**Requirements:** R3, R4, R5.

**Dependencies:** U2 (uses existing offer/listing mappings, no pool state needed).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** Two view functions following the same pattern:

- `gatherLendCapacities(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)` -- calls `StreamPricing.marketActive(address(factory), core, market)` as deadline gate. Scans `lendOffers[i]` from `startId` to `nextLendOfferId`. Filters: `active && market == market && aprBps == aprBps && capacity > 0`. Accumulates capacity. Stops when `gathered >= targetAmount`. Returns `(uint256[] ids, bool sufficient)`. Single loop, max-size allocation, assembly trim.
- `gatherBorrowListings(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)` -- same pattern, scans `borrowListings[i]`, accumulates `borrowAmount` instead of `capacity`.

**Patterns to follow:** Existing view function patterns (`saleOfferState`, `lendOfferState`, etc.). `marketActive` call pattern from `_requireMarketActive`. Assembly trim is a standard view-function pattern for variable-length results.

**Test scenarios:**
- Gather with matching offers and sufficient capacity -- returns IDs, `sufficient = true`.
- Gather with matching offers but insufficient capacity -- returns partial IDs, `sufficient = false`.
- Gather with no matching offers -- returns empty array, `sufficient = false`.
- Gather with expired series -- reverts `SeriesMatured` (from `marketActive`).
- Gather skips cancelled offers (`active = false`).
- Gather skips depleted offers (`capacity = 0`).
- Gather skips offers for different market or aprBps.
- Gather with `startId` > `nextLendOfferId` -- returns empty, `sufficient = false`.
- Gather for borrow listings -- same scenarios with `borrowAmount` accumulation.

**Verification:** `forge build` passes. `forge test --match-test "gather"` passes.

---

### U5. Borrower pool creation

**Goal:** Add `createBorrowPool` function that batches `borrowAgainstOffer` across multiple lend offers.

**Requirements:** R6, R7, R8, R9. Covers AE1, AE2.

**Dependencies:** U2 (Pool struct, mappings), U3 (loan servicing integration).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** `createBorrowPool(uint256[] calldata offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`:

1. Validate stream eligibility via `_requireEligible` (gets `remaining`, `seriesMaturity`, `ovrfloToken`).
2. Loop through `offerIds`: validate each offer (`active`, `market` matches stream's market, `aprBps` matches across all offers, `offer.maker != msg.sender` for self-match prevention). Accumulate capacity until `targetBorrow` is met or offers exhausted.
3. If total available < `minAcceptable`, revert. No offers consumed (CEI: validate all before consuming any).
4. Create Pool: `pools[nextPoolId] = Pool(msg.sender, market, aprBps, totalBorrowed, false, true)`.
5. Consume each offer: decrement `capacity`, record `poolContributions[poolId][offer.maker] += consumed`.
6. Create one loan: `_storeLoan(msg.sender, address(this), streamId, obligation, ...)`. Set `loanPoolId[loanId] = poolId`. Transfer stream NFT to book.
7. Pay underlying to borrower (minus fees), fees to treasury.
8. Emit `PoolCreated`.

**Patterns to follow:** Existing `borrowAgainstOffer` logic for pricing, fee calculation, stream escrow, and loan creation. Factor shared logic into internal helpers if it reduces duplication. `nonReentrant` modifier on the function. CEI: validate all offers before consuming any.

**Test scenarios:**
- Create pool with 2 offers, sufficient capacity -- loan created, borrower paid, each lender's contribution recorded. All-party balance assertions (borrower, each lender, treasury, book). Covers AE2.
- Create pool with `minAcceptable` above available -- reverts, no offers consumed. Covers AE1.
- Create pool with partial coverage above `minAcceptable` -- succeeds with reduced amount. Obligation based on actual borrowed, not target.
- Self-match: borrower is one of the offer makers -- reverts.
- Offer with wrong market -- reverts or skipped.
- Offer with wrong `aprBps` -- reverts or skipped.
- Cancelled offer in the list -- reverts or skipped.
- Stream eligibility check fails -- reverts.
- All offers must share the same `aprBps` -- revert if mixed rates.
- `poolProceeds` starts at 0 after creation.
- `loanPoolId[loanId]` is set to `poolId`.

**Verification:** `forge build` passes. `forge test --match-test "BorrowPool"` passes. All-party balance assertions present.

---

### U6. Lender pool creation

**Goal:** Add `createLenderPool` function that batches `lendAgainstListing` across multiple borrow listings.

**Requirements:** R10, R11, R12, R13. Covers AE1, AE2 (lender pool variant).

**Dependencies:** U2 (Pool struct, mappings), U3 (loan servicing integration).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:** `createLenderPool(uint256[] calldata listingIds, uint128 totalAmount, uint128 minAcceptable)`:

1. Pull `totalAmount` underlying from the lender.
2. Loop through `listingIds`: validate each listing (`active`, `market` matches, `aprBps` matches across all listings). For each listing, calculate `grossPrice` via `StreamPricing.grossPrice`. Create a loan per listing with `loan.lender = address(this)`, `loanPoolId[loanId] = poolId`. Transfer underlying (minus fees) to each borrower. Escrow each listing's stream.
3. If total deployed < `minAcceptable`, revert. Return all pulled underlying to lender.
4. If total deployed < `totalAmount`, return unused to lender.
5. Create Pool: `pools[nextPoolId] = Pool(msg.sender, market, aprBps, totalDeployed, true, true)`. Record `poolContributions[poolId][msg.sender] = totalDeployed`.
6. Emit `PoolCreated`.

**Patterns to follow:** Existing `lendAgainstListing` logic for pricing, fee calculation, stream escrow, and loan creation. `nonReentrant` modifier. CEI: validate all listings before creating any loans.

**Test scenarios:**
- Create pool with 3 listings, sufficient total -- loans created, each borrower paid, lender deployed. All-party balance assertions (lender, each borrower, treasury, book). Covers AE2.
- Create pool with `minAcceptable` above available -- reverts, all underlying returned to lender. Covers AE1.
- Create pool with partial coverage -- succeeds, unused capital returned to lender.
- Listing with wrong market -- reverts or skipped.
- Listing with wrong `aprBps` -- reverts or skipped.
- Cancelled listing in the list -- reverts or skipped.
- All listings must share the same `aprBps` -- revert if mixed rates.
- Each loan has `loanPoolId` set to `poolId`.
- `poolProceeds` starts at 0 after creation.
- Lender's `poolContributions` equals total deployed.

**Verification:** `forge build` passes. `forge test --match-test "LenderPool"` passes. All-party balance assertions present.

---

### U7. Pool claims

**Goal:** Add `poolClaimLoan` and `claimPoolShare` functions for address-based pro-rata claims.

**Requirements:** R14, R15, R16. Covers AE3, AE4.

**Dependencies:** U2 (pool mappings), U3 (loan servicing), U5 or U6 (pools must exist to test claims).

**Files:** `src/OVRFLOBook.sol` (modify), `test/OVRFLOBook.t.sol` (modify).

**Approach:**

`poolClaimLoan(uint256 poolId, uint256 loanId, uint128 amount)`:
1. Verify `poolContributions[poolId][msg.sender] > 0` (caller is a contributor).
2. Verify `loanPoolId[loanId] == poolId` (loan belongs to this pool).
3. Verify `!loan.closed`.
4. Calculate entitlement = `poolContributions[poolId][msg.sender] * loan.obligation / poolTotalContributed[poolId]`.
5. Calculate remaining = `entitlement - poolReceived[poolId][msg.sender]`.
6. Calculate stream claimable (from `sablier.getWithdrawableAmount` minus `loan.drawn` outstanding).
7. Draw `min(amount, remaining, streamClaimable)` from stream via `sablier.withdraw(streamId, msg.sender, drawAmount)`.
8. Update `poolReceived[poolId][msg.sender] += drawAmount`. `loan.drawn += drawAmount`.
9. Emit `PoolLoanClaimed`.

`claimPoolShare(uint256 poolId, uint128 amount)`:
1. Verify `poolContributions[poolId][msg.sender] > 0`.
2. Calculate entitlement and remaining (same as above; for lender pools, obligation is sum across all pool loans).
3. Available from poolProceeds = `min(poolProceeds[poolId], remaining)`.
4. Transfer `min(amount, available)` ovrfloToken to caller.
5. Update `poolReceived[poolId][msg.sender] += claimed`. `poolProceeds[poolId] -= claimed`.
6. Emit `PoolShareClaimed`.

**Patterns to follow:** Existing `claimLoan` pattern for stream drawing. Existing `_payUnderlying` pattern for token transfers. `nonReentrant` on both functions.

**Test scenarios:**
- `poolClaimLoan` -- contributor draws from stream, ovrfloToken goes directly to caller. `poolReceived` updated. Covers AE3 (direct draw variant).
- `claimPoolShare` -- contributor claims from `poolProceeds`. `poolReceived` and `poolProceeds` updated. Covers AE3.
- Over-claim prevention: claim more than entitlement -- reverts. Covers AE4.
- Double-dip prevention: draw from stream, then claim from pool -- total capped at entitlement.
- Non-contributor calls `poolClaimLoan` -- reverts.
- Non-contributor calls `claimPoolShare` -- reverts.
- Caller draws from wrong pool's loan -- reverts (`loanPoolId` mismatch).
- Caller draws from closed loan -- reverts.
- Pro-rata verification: Alice 60%, Bob 40%, total obligation 1100. Alice can draw up to 660, Bob up to 440.
- After full claim, `poolReceived == entitlement` for each contributor.
- All-party balance assertions on each claim.
- `poolProceeds` never goes below 0 (checked via assert).
- Book's ovrfloToken balance >= sum of all `poolProceeds` (invariant).

**Verification:** `forge build` passes. `forge test --match-test "Pool"` passes. All acceptance examples verified.

---

## Verification Contract

| Gate | Command | Scope |
|------|---------|-------|
| Compile | `forge build` | All units |
| Non-fork tests | `forge test` | All units -- must pass with 0 failures |
| Rate constraint | `forge test --match-test "apr"` | U1 |
| Pool creation | `forge test --match-test "BorrowPool\|LenderPool"` | U5, U6 |
| Pool claims | `forge test --match-test "Pool"` | U7 |
| Gather functions | `forge test --match-test "gather"` | U4 |
| Loan servicing | `forge test --match-test "closeLoan\|repayLoan\|claimLoan"` | U3 |
| Format | `forge fmt` | All units |
| Gas snapshot | `forge snapshot` | Compare pool function gas costs |

**Invariant tests to add:**
- Book's ovrfloToken balance >= sum of all `poolProceeds` values.
- For each pool: sum of `poolReceived[poolId][*]` <= `poolProceeds[poolId]` + total drawn via `poolClaimLoan`.
- For each pool: `poolTotalContributed == sum of poolContributions[poolId][*]`.

---

## Definition of Done

- All 7 implementation units complete and verified per their Verification sections.
- `forge build` passes with 0 errors.
- `forge test` passes with 0 failures (all existing tests + new pool tests).
- `forge fmt` passes (no formatting changes needed).
- All 6 acceptance examples (AE1-AE6) have corresponding passing tests.
- All-party balance assertions present on every pool creation and claim test (critical pattern #7).
- Self-match prevention tested for borrower pools (KTD5).
- Double-dip prevention tested for pool claims (KTD2).
- Non-pool loans verified unaffected (AE5).
- Pool invariant tests pass (book ovrfloToken balance >= sum of poolProceeds).
- `CONCEPTS.md` updated with "Pool" entry if the term becomes canonical during implementation.
