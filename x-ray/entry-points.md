# Entry Point Map

> OVRFLO | 37 entry points | 14 permissionless | 6 role-gated | 17 admin-only

---

## Protocol Flow Paths

### Setup (Factory Owner / Multisig)

`configureDeployment()` → `deploy()` → `addMarket()`  
`[addMarket above]` → `setMarketDepositLimit()` / `prepareOracle()`  
`[deploy above]` → `OVRFLOBook.setAprBounds()` / `setFee()` / `setTreasury()`

### Core User Flow (OVRFLO)

`[addMarket above]` → `OVRFLO.wrap()` → `OVRFLO.unwrap()`  
`[addMarket above]` → `OVRFLO.deposit()` → `OVRFLO.claim()` ◄── requires maturity passage

### Secondary Sale Flow

`[addMarket above]` → `OVRFLO.deposit()` → Sablier stream NFT minted  
`[stream minted above]` → `OVRFLOBook.postOffer()` → `OVRFLOBook.hitOffer()`  
`[stream minted above]` → `OVRFLOBook.listStream()` → `OVRFLOBook.takeListing()`

### Secondary Lending Flow

`[stream minted above]` → `OVRFLOBook.postLendOffer()` → `OVRFLOBook.borrowAgainstOffer()`  
`[stream minted above]` → `OVRFLOBook.postBorrowListing()` → `OVRFLOBook.lendAgainstListing()`  
`[loan originated above]` → `OVRFLOBook.claimLoan()` / `OVRFLOBook.repayLoan()` / `OVRFLOBook.closeLoan()` ◄── close requires withdrawable >= outstanding

---

## Permissionless

### `OVRFLO.wrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | User |
| Parameters | `amount (user-controlled)` |
| Call chain | `→ OVRFLOFactory.ovrfloInfo() → IERC20.transferFrom() → OVRFLOToken.mint()` |
| State modified | `wrappedUnderlying` |
| Value flow | Tokens: user underlying → vault; mint `ovrfloToken` to user |
| Reentrancy guard | no |

### `OVRFLO.unwrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | User |
| Parameters | `amount (user-controlled)` |
| Call chain | `→ OVRFLOFactory.ovrfloInfo() → OVRFLOToken.burn() → IERC20.transfer()` |
| State modified | `wrappedUnderlying` |
| Value flow | Tokens: burn `ovrfloToken`; vault underlying → user |
| Reentrancy guard | no |

### `OVRFLO.deposit()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | User |
| Parameters | `market (user-controlled)`, `ptAmount (user-controlled)`, `minToUser (user-controlled)` |
| Call chain | `→ IERC20(PT).transferFrom() → IPendleOracle.getPtToSyRate() → IERC20(underlying).transferFrom() → OVRFLOToken.mint() → Sablier.createWithDurations()` |
| State modified | `marketTotalDeposited[market]` |
| Value flow | Tokens: user PT in; optional underlying fee in; `ovrfloToken` mint to user and stream |
| Reentrancy guard | no |

### `OVRFLO.claim()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | User |
| Parameters | `ptToken (user-controlled)`, `amount (user-controlled)` |
| Call chain | `→ OVRFLOToken.burn() → IERC20(PT).transfer()` |
| State modified | `marketTotalDeposited[ptToMarket[ptToken]]` |
| Value flow | Tokens: burn `ovrfloToken`; vault PT out to user |
| Reentrancy guard | no |

### `OVRFLOBook.postOffer()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | User / buyer-side liquidity maker |
| Parameters | `market (user-controlled)`, `aprBps (user-controlled)`, `capacity (user-controlled)` |
| Call chain | `→ _validateApr() → _pullExact(IERC20(underlying).transferFrom())` |
| State modified | `nextSaleOfferId`, `saleOffers[offerId]` |
| Value flow | Tokens: maker underlying escrowed into book |
| Reentrancy guard | yes |

### `OVRFLOBook.hitOffer()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Stream holder / seller |
| Parameters | `offerId (user-controlled)`, `streamId (user-controlled)`, `minNetOut (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible() → StreamPricing.grossPrice()/fee() → Sablier.transferFrom() → _payUnderlying()` |
| State modified | `saleOffers[offerId].capacity`, `saleOffers[offerId].active` |
| Value flow | Tokens: underlying out to seller + treasury; stream NFT transferred to offer maker |
| Reentrancy guard | yes |

### `OVRFLOBook.listStream()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Stream holder / seller |
| Parameters | `market (user-controlled)`, `streamId (user-controlled)`, `aprBps (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible() → Sablier.transferFrom()` |
| State modified | `nextSaleListingId`, `saleListings[listingId]` |
| Value flow | Value: stream NFT escrowed into book |
| Reentrancy guard | yes |

### `OVRFLOBook.takeListing()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Buyer |
| Parameters | `listingId (user-controlled)`, `maxPriceIn (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible() → _pullExact(IERC20.transferFrom()) → _payUnderlying() → Sablier.transferFrom()` |
| State modified | `saleListings[listingId].active` |
| Value flow | Tokens: buyer underlying in; seller/treasury underlying out; stream NFT to buyer |
| Reentrancy guard | yes |

### `OVRFLOBook.postLendOffer()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Lender |
| Parameters | `market (user-controlled)`, `aprBps (user-controlled)`, `capacity (user-controlled)` |
| Call chain | `→ _validateApr() → _pullExact(IERC20.transferFrom())` |
| State modified | `nextLendOfferId`, `lendOffers[offerId]` |
| Value flow | Tokens: lender underlying escrowed into book |
| Reentrancy guard | yes |

### `OVRFLOBook.borrowAgainstOffer()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Borrower / stream holder |
| Parameters | `offerId (user-controlled)`, `streamId (user-controlled)`, `borrowAmount (user-controlled)`, `minNetOut (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible()/grossPrice()/obligationForFill()/fee() → _storeLoan() → Sablier.transferFrom() → _payUnderlying()` |
| State modified | `lendOffers[offerId].capacity`, `lendOffers[offerId].active`, `nextLoanId`, `loans[loanId]` |
| Value flow | Tokens: underlying out to borrower + treasury; stream NFT escrowed |
| Reentrancy guard | yes |

### `OVRFLOBook.postBorrowListing()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Borrower / stream holder |
| Parameters | `market (user-controlled)`, `streamId (user-controlled)`, `aprBps (user-controlled)`, `borrowAmount (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible()/grossPrice() → Sablier.transferFrom()` |
| State modified | `nextBorrowListingId`, `borrowListings[listingId]` |
| Value flow | Value: stream NFT escrowed into book |
| Reentrancy guard | yes |

### `OVRFLOBook.lendAgainstListing()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Lender |
| Parameters | `listingId (user-controlled)`, `minObligationOut (user-controlled)` |
| Call chain | `→ StreamPricing.requireEligible()/grossPrice()/obligationForFill()/fee() → _storeLoan() → _pullExact(IERC20.transferFrom()) → _payUnderlying()` |
| State modified | `borrowListings[listingId].active`, `nextLoanId`, `loans[loanId]` |
| Value flow | Tokens: lender underlying in; borrower + treasury underlying out |
| Reentrancy guard | yes |

### `OVRFLOBook.closeLoan()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (permissionless close trigger) |
| Parameters | `loanId (user-controlled)` |
| Call chain | `→ Sablier.withdrawableAmountOf() → Sablier.withdraw() → Sablier.transferFrom()` |
| State modified | `loans[loanId].closed`, `loans[loanId].drawn` |
| Value flow | Value: lender receives remaining withdrawable stream value; stream NFT returned to borrower |
| Reentrancy guard | yes |

---

## Role-Gated

### Dynamic Maker/Lender/Borrower Gates

| Contract | Function | Effective Gate | Parameters | State Modified |
|----------|----------|----------------|------------|----------------|
| OVRFLOBook | `cancelOffer()` | `offer.maker == msg.sender` | `offerId (user-controlled)` | `saleOffers[offerId].capacity`, `saleOffers[offerId].active` |
| OVRFLOBook | `cancelListing()` | `listing.maker == msg.sender` | `listingId (user-controlled)` | `saleListings[listingId].active` |
| OVRFLOBook | `cancelLendOffer()` | `offer.lender == msg.sender` | `offerId (user-controlled)` | `lendOffers[offerId].capacity`, `lendOffers[offerId].active` |
| OVRFLOBook | `cancelBorrowListing()` | `listing.borrower == msg.sender` | `listingId (user-controlled)` | `borrowListings[listingId].active` |
| OVRFLOBook | `claimLoan()` | `loan.lender == msg.sender` | `loanId (user-controlled)` | `loans[loanId].drawn` |
| OVRFLOBook | `repayLoan()` | `loan.borrower == msg.sender` | `loanId (user-controlled)`, `amount (user-controlled)` | `loans[loanId].repaid`, `loans[loanId].closed` |

---

## Admin-Only

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOFactory | `configureDeployment()` | `treasury`, `underlying`, `nameSuffix`, `symbolSuffix` | `pendingDeployment` |
| OVRFLOFactory | `cancelDeployment()` | none | `pendingDeployment` |
| OVRFLOFactory | `deploy()` | none | `ovrflos`, `ovrfloCount`, `ovrfloInfo` |
| OVRFLOFactory | `addMarket()` | `ovrflo`, `market`, `oracle`, `twapDuration`, `feeBps` | `isMarketApproved`, `approvedMarketAt`, `approvedMarketCount` |
| OVRFLOFactory | `setMarketDepositLimit()` | `ovrflo`, `market`, `limit` | downstream `OVRFLO.marketDepositLimits` |
| OVRFLOFactory | `sweepExcessPt()` | `ovrflo`, `ptToken`, `to` | none (token transfer only) |
| OVRFLOFactory | `sweepExcessUnderlying()` | `ovrflo`, `to` | none (token transfer only) |
| OVRFLOFactory | `prepareOracle()` | `market`, `oracle`, `twapDuration` | Pendle observation cardinality |
| OVRFLO | `setSeriesApproved()` | `market`, `pt`, `underlying`, `ovrfloToken`, `oracle`, `twapDuration`, `expiry`, `feeBps` | `series`, `ptToMarket` |
| OVRFLO | `setMarketDepositLimit()` | `market`, `limit` | `marketDepositLimits[market]` |
| OVRFLO | `sweepExcessPt()` | `ptToken`, `to` | none (token transfer only) |
| OVRFLO | `sweepExcessUnderlying()` | `to` | none (token transfer only) |
| OVRFLOToken | `transferOwnership()` | `newOwner` | `owner` |
| OVRFLOToken | `mint()` | `to`, `amount` | ERC20 `_totalSupply`, `balanceOf[to]` |
| OVRFLOToken | `burn()` | `from`, `amount` | ERC20 `_totalSupply`, `balanceOf[from]` |
| OVRFLOBook | `setAprBounds()` | `aprMinBps_`, `aprMaxBps_` | `aprMinBps`, `aprMaxBps` |
| OVRFLOBook | `setFee()` | `feeBps_` | `feeBps` |
| OVRFLOBook | `setTreasury()` | `treasury_` | `treasury` |

---

## Initialization

- No proxy `initialize()` entry points are present in scope; deployment is constructor-based (`OVRFLOFactory`, `OVRFLO`, `OVRFLOToken`, `OVRFLOBook`).
