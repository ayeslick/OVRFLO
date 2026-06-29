# Entry Point Map

> OVRFLO | 42 entry points | 14 permissionless | 8 role-gated | 20 admin-only

---

## Protocol Flow Paths

### Setup (Multisig)

`OVRFLOFactory.configureDeployment()` → `OVRFLOFactory.deploy()` → `OVRFLOFactory.prepareOracle()` → `OVRFLOFactory.addMarket()`  ◄── oracle cardinality must be ready first
                                                   └─→ `OVRFLOFactory.setMarketDepositLimit()`  ◄── optional per-market cap

### Book Deployment (Multisig)

`[factory deploy above]` → `new OVRFLOBook(factory, ovrflo, sablier)` → `OVRFLOBook.setFee()` / `setAprBounds()` → `OVRFLOBook.transferOwnership(multisig)` → `acceptOwnership()`

### Depositor Flow

`[factory addMarket above]` → user approves PT + underlying → `OVRFLO.deposit()`  ◄── block.timestamp < expiry
                                                   ├─→ `OVRFLO.claim()`  ◄── block.timestamp >= expiry
                                                   ├─→ `OVRFLO.wrap()` / `OVRFLO.unwrap()`  ◄── wrap reserve funded
                                                   └─→ stream NFT → `OVRFLOBook.postSaleListing()` / `postBorrowListing()` / `sellIntoOffer()` / `createBorrowPool()`

### Loan Servicing (Lender / Borrower / Anyone)

`[borrow opened above]` → `OVRFLOBook.poolClaimLoan()`  ◄── pool contributor, withdrawable > 0
                         ├─→ `OVRFLOBook.repayLoan()`  ◄── borrower only
                         └─→ `OVRFLOBook.closeLoan()`  ◄── permissionless, withdrawable >= outstanding

### Offer / Listing Lifecycle (Maker / Taker)

`OVRFLOBook.postSaleOffer()` / `postLendOffer()`  ◄── maker funds capacity
   ├─→ `OVRFLOBook.cancelSaleOffer()` / `cancelLendOffer()`  ◄── maker only
   └─→ `OVRFLOBook.sellIntoOffer()` / `createBorrowPool()`  ◄── taker fills

`OVRFLOBook.postSaleListing()` / `postBorrowListing()`  ◄── maker escrows stream
   ├─→ `OVRFLOBook.cancelSaleListing()` / `cancelBorrowListing()`  ◄── maker only
   └─→ `OVRFLOBook.buyListing()` / `createLenderPool()`  ◄── taker fills

---

## Permissionless

### `OVRFLO.deposit(address market, uint256 ptAmount, uint256 minToUser)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | User (PT depositor) |
| Parameters | market (user-controlled), ptAmount (user-controlled), minToUser (user-controlled) |
| Call chain | `→ IERC20(ptToken).safeTransferFrom` → `IPendleOracle(oracle).getPtToSyRate` → `OVRFLOToken.mint` (x2) → `IERC20(underlying).safeTransferFrom` (fee) → `sablierLL.createWithDurations` |
| State modified | `marketTotalDeposited[market]` (+ptAmount); ovrfloToken totalSupply (+toUser+toStream) |
| Value flow | PT: user → vault; underlying fee: user → treasury; ovrfloToken minted to user + vault |
| Reentrancy guard | no |

### `OVRFLO.claim(address ptToken, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | User (ovrfloToken holder, post-maturity) |
| Parameters | ptToken (user-controlled), amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn` → `IERC20(ptToken).safeTransfer` |
| State modified | `marketTotalDeposited[market]` (-amount); ovrfloToken totalSupply (-amount) |
| Value flow | ovrfloToken burned; PT: vault → user |
| Reentrancy guard | no |

### `OVRFLO.wrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | User |
| Parameters | amount (user-controlled) |
| Call chain | `→ IERC20(underlying).safeTransferFrom` (balance-delta checked) → `OVRFLOToken.mint` |
| State modified | `wrappedUnderlying` (+amount); ovrfloToken totalSupply (+amount) |
| Value flow | underlying: user → vault; ovrfloToken minted to user |
| Reentrancy guard | no |

### `OVRFLO.unwrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | User |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn` → `IERC20(underlying).safeTransfer` |
| State modified | `wrappedUnderlying` (-amount); ovrfloToken totalSupply (-amount) |
| Value flow | ovrfloToken burned; underlying: vault → user |
| Reentrancy guard | no |

### `OVRFLOBook.postSaleOffer(address market, uint16 aprBps, uint128 capacity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (market maker) |
| Parameters | market (user-controlled), aprBps (user-controlled), capacity (user-controlled) |
| Call chain | `→ StreamPricing.marketActive` → `IERC20(underlying).safeTransferFrom` (balance-delta via `_pullExact`) |
| State modified | `saleOffers[id]` (new); `nextSaleOfferId` (+1) |
| Value flow | underlying: maker → book |
| Reentrancy guard | yes |

### `OVRFLOBook.sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (stream seller) |
| Parameters | offerId (user-controlled), streamId (user-controlled), minNetOut (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `StreamPricing.grossPrice/fee` → `sablier.transferFrom(seller, maker)` → `_payUnderlying` (x2) |
| State modified | `saleOffers[offerId].capacity` (-grossPrice), `.active` maybe false |
| Value flow | stream NFT: seller → maker; underlying: book → seller (net) + treasury (fee) |
| Reentrancy guard | yes |

### `OVRFLOBook.postSaleListing(address market, uint256 streamId, uint16 aprBps)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (stream seller) |
| Parameters | market (user-controlled), streamId (user-controlled), aprBps (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `sablier.transferFrom(seller, book)` |
| State modified | `saleListings[id]` (new, feeBps snapshotted); `nextSaleListingId` (+1) |
| Value flow | stream NFT: seller → book escrow |
| Reentrancy guard | yes |

### `OVRFLOBook.buyListing(uint256 listingId, uint256 maxPriceIn)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (buyer) |
| Parameters | listingId (user-controlled), maxPriceIn (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `grossPrice/fee` → `_pullExact(underlying)` → `_payUnderlying` (x2) → `sablier.transferFrom(book, buyer)` |
| State modified | `saleListings[id].active` (false) |
| Value flow | underlying: buyer → book → seller (net) + treasury (fee); stream NFT: book → buyer |
| Reentrancy guard | yes |

### `OVRFLOBook.postLendOffer(address market, uint16 aprBps, uint128 capacity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (lender) |
| Parameters | market (user-controlled), aprBps (user-controlled), capacity (user-controlled) |
| Call chain | `→ StreamPricing.marketActive` → `_pullExact(underlying)` |
| State modified | `lendOffers[id]` (new); `nextLendOfferId` (+1) |
| Value flow | underlying: lender → book |
| Reentrancy guard | yes |

### `OVRFLOBook.createBorrowPool(uint256[] offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (borrower) |
| Parameters | offerIds, streamId, targetBorrow, minAcceptable (all user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `grossPrice/obligationForFill/fee` → `_validateBorrowOffers` → `_consumeBorrowOffers` → `_storeLoan` → `sablier.transferFrom(borrower, book)` → `_payUnderlying` (x2) |
| State modified | `lendOffers[offerIds].capacity` (-consumed); `pools[id]` (new); `loans[id]` (new); `nextPoolId` (+1); `nextLoanId` (+N) |
| Value flow | stream NFT: borrower → book escrow; underlying: book → borrower (net) + treasury (fee) |
| Reentrancy guard | yes |

### `OVRFLOBook.postBorrowListing(address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (borrower) |
| Parameters | market, streamId, aprBps, borrowAmount (all user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `grossPrice` → `sablier.transferFrom(borrower, book)` |
| State modified | `borrowListings[id]` (new, feeBps snapshotted); `nextBorrowListingId` (+1) |
| Value flow | stream NFT: borrower → book escrow |
| Reentrancy guard | yes |

### `OVRFLOBook.createLenderPool(uint256[] listingIds, uint128 totalAmount, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User (lender) |
| Parameters | listingIds, totalAmount, minAcceptable (all user-controlled) |
| Call chain | `→ StreamPricing.requireEligible` → `grossPrice/obligationForFill/fee` → `_pullExact(underlying)` → `_storeLoan` (per listing) → `sablier.transferFrom(borrower, book)` (per listing) → `_payUnderlying` (x2) |
| State modified | `borrowListings[ids].active` (false); `pools[id]` (new); `loans[id]` (new); `nextPoolId` (+1); `nextLoanId` (+N) |
| Value flow | underlying: lender → book → borrowers (net) + treasury (fee); stream NFTs: borrowers → book escrow |
| Reentrancy guard | yes |

### `OVRFLOBook.closeLoan(uint256 loanId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (permissionless liveness) |
| Parameters | loanId (user-controlled) |
| Call chain | `→ sablier.withdrawableAmountOf` → `sablier.withdraw` (if outstanding > 0) → `sablier.transferFrom(book, borrower)` |
| State modified | `loans[id].closed` (true); `loans[id].drawn` (+outstanding) |
| Value flow | ovrfloToken: stream → `poolProceeds` (draw); stream NFT: book → borrower |
| Reentrancy guard | yes |

### `OVRFLOBook.multicall(bytes[])` *(inherited)*

| Aspect | Detail |
|--------|--------|
| Visibility | public, no reentrancy guard |
| Caller | Anyone (batch helper; delegates to other entry points which retain their own access checks) |
| Parameters | calldata array (user-controlled) |
| Call chain | `→ delegatecall(self, each selector)` |
| State modified | whatever the batched calls modify |
| Value flow | none directly |
| Reentrancy guard | no |

---

## Role-Gated

### Offer/listing owner (maker)

| Contract | Function | Gate | State Modified |
|----------|----------|------|----------------|
| OVRFLOBook | `cancelSaleOffer(offerId)` | `offer.maker == msg.sender` | `saleOffers[id].capacity=0, active=false`; underlying refunded |
| OVRFLOBook | `cancelSaleListing(listingId)` | `listing.maker == msg.sender` | `saleListings[id].active=false`; stream returned |
| OVRFLOBook | `cancelLendOffer(offerId)` | `offer.lender == msg.sender` | `lendOffers[id].capacity=0, active=false`; underlying refunded |
| OVRFLOBook | `cancelBorrowListing(listingId)` | `listing.borrower == msg.sender` | `borrowListings[id].active=false`; stream returned |

### Loan owner (lender / borrower)

| Contract | Function | Gate | State Modified |
|----------|----------|------|----------------|
| OVRFLOBook | `poolClaimLoan(poolId, loanId, amount)` | pool contributor | `loans[id].drawn` (+amount); ovrfloToken drawn to caller |
| OVRFLOBook | `repayLoan(loanId, amount)` | `loan.borrower == msg.sender` | `loans[id].repaid` (+amount), maybe `closed=true`; ovrfloToken to `poolProceeds`; stream returned if closed |

### Pending owner (two-step accept)

| Contract | Function | Gate | State Modified |
|----------|----------|------|----------------|
| OVRFLOFactory | `acceptOwnership()` | `msg.sender == pendingOwner` | owner finalized |
| OVRFLOBook | `acceptOwnership()` | `msg.sender == pendingOwner` | owner finalized |

---

## Admin-Only

### OVRFLOFactory (multisig via `onlyOwner`)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | deploy config | `pendingDeployment` set |
| `cancelDeployment()` | — | `pendingDeployment` deleted |
| `deploy()` | — | new OVRFLO + OVRFLOToken; `ovrflos[]`, `ovrfloInfo[]`, `ovrfloCount` updated |
| `addMarket(ovrflo, market, twapDuration, feeBps)` | market config | `isMarketApproved`, `approvedMarketAt[]`, `approvedMarketCount`; vault `setSeriesApproved` called |
| `setMarketDepositLimit(ovrflo, market, limit)` | cap | vault `marketDepositLimits[market]` (no check vs current deposited) |
| `sweepExcessPt(ovrflo, ptToken, to)` | recipient | vault excess PT → `to` |
| `sweepExcessUnderlying(ovrflo, to)` | recipient | vault excess underlying → `to` |
| `prepareOracle(market, twapDuration)` | oracle config | Pendle market cardinality increased |
| `transferOwnership(newOwner)` | nominee | `pendingOwner` set (two-step) |

### OVRFLO (factory via `onlyAdmin`)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setSeriesApproved(market, pt, twapDuration, expiry, feeBps)` | series config | `_series[market]`, `ptToMarket[pt]` (one-shot) |
| `setMarketDepositLimit(market, limit)` | cap | `marketDepositLimits[market]` (no check vs current deposited) |
| `sweepExcessPt(ptToken, to)` | recipient | excess PT → `to` |
| `sweepExcessUnderlying(to)` | recipient | excess underlying → `to` |

### OVRFLOBook (multisig via `onlyOwner`)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setAprBounds(aprMinBps, aprMaxBps)` | APR range | `aprMinBps`, `aprMaxBps` (≤10_000, no effect on existing offers) |
| `setFee(feeBps)` | fee | `feeBps` (≤10_000, no effect on existing listings) |
| `setTreasury(treasury)` | recipient | `treasury` |
| `transferOwnership(newOwner)` | nominee | `pendingOwner` set (two-step) |

### OVRFLOToken (vault via `onlyOwner`)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `mint(to, amount)` | mintee, qty | `totalSupply`, `balanceOf[to]` (+amount) |
| `burn(from, amount)` | burner, qty | `totalSupply`, `balanceOf[from]` (-amount) |
| `transferOwnership(newOwner)` | new owner | `owner` (single-step, no two-step) |

> Standard ERC20 (`transfer`, `transferFrom`, `approve`) are inherited from OpenZeppelin ERC20 on `OVRFLOToken`; they are permissionless but not protocol logic.
