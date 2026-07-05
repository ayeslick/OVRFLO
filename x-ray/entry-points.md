# Entry Point Map

> OVRFLO | 42 entry points | 11 permissionless | 5 role-gated | 26 admin-only

---

## Protocol Flow Paths

### Setup (Multisig)

`configureDeployment()` → `deploy()` → `deployBook()` → `addMarket()` ◄── `prepareOracle()` must run first if cardinality insufficient

### Depositor Flow

`[multisig setup above]` → `OVRFLO.deposit()` → `Sablier.withdraw()` ◄── vesting over time
                                                    └─→ `OVRFLO.claim()` ◄── post-maturity

### Wrapper Flow

`[multisig setup above]` → `OVRFLO.wrap()` → `OVRFLO.unwrap()` ◄── anytime if reserve funded

### Stream Seller Flow

`[deposit above]` → `OVRFLOBook.postOffer()` → `OVRFLOBook.sellIntoOffer()` ◄── seller must own stream
                                    └─→ `OVRFLOBook.cancelOffer()`

### Stream Lister Flow

`[deposit above]` → `OVRFLOBook.postSaleListing()` → `OVRFLOBook.buyListing()`
                                          └─→ `OVRFLOBook.cancelSaleListing()`

### Borrower Flow

`[deposit above]` → `OVRFLOBook.postOffer()` ◄── liquidity providers post offers
                  → `OVRFLOBook.createBorrowPool()` ◄── borrower pledges stream
                      ├─→ `OVRFLOBook.closeLoan()` ◄── permissionless, stream accrued enough
                      ├─→ `OVRFLOBook.repayLoan()` ◄── borrower only
                      └─→ Pool claims: `poolClaimLoan()` | `claimPoolShare()` ◄── contributors only

### Flash Loan Flow

`[addMarket above]` → `OVRFLO.flashLoan()` → `IFlashBorrower.onFlashLoan()` → repay PT + fee

---

## Permissionless

### `OVRFLO.wrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.mint(msg.sender, amount)` |
| State modified | `wrappedUnderlying += amount` |
| Value flow | underlying: msg.sender → vault (in); ovrfloToken: vault → msg.sender (out) |
| Reentrancy guard | no |

### `OVRFLO.unwrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone holding ovrfloToken |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn(msg.sender, amount)` → `IERC20(underlying).safeTransfer(msg.sender, amount)` |
| State modified | `wrappedUnderlying -= amount` |
| Value flow | ovrfloToken: msg.sender → burn (in); underlying: vault → msg.sender (out) |
| Reentrancy guard | no |

### `OVRFLO.deposit(address market, uint256 ptAmount, uint256 minToUser)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | PT holder |
| Parameters | market (user-controlled), ptAmount (user-controlled), minToUser (user-controlled) |
| Call chain | `→ _requireOracleFresh()` → `IPendleOracle.getPtToSyRate()` → `OVRFLOToken.mint(user, toUser)` → `OVRFLOToken.mint(vault, toStream)` → `ISablierV2LockupLinear.createWithDurations()` |
| State modified | `marketTotalDeposited[market] += ptAmount` |
| Value flow | PT: msg.sender → vault (in); underlying: msg.sender → treasury (fee, in); ovrfloToken: vault → msg.sender (out) |
| Reentrancy guard | no |

### `OVRFLO.claim(address ptToken, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder (post-maturity) |
| Parameters | ptToken (user-controlled), amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn(msg.sender, amount)` → `IERC20(ptToken).safeTransfer(msg.sender, amount)` |
| State modified | `marketTotalDeposited[market] -= amount` |
| Value flow | ovrfloToken: msg.sender → burn (in); PT: vault → msg.sender (out) |
| Reentrancy guard | no |

### `OVRFLO.flashLoan(address ptToken, uint256 amount, bytes data)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (borrower contract implementing IFlashBorrower) |
| Parameters | ptToken (user-controlled), amount (user-controlled), data (user-controlled) |
| Call chain | `→ _requireOracleFresh()` → `IPendleOracle.getPtToSyRate()` → `IERC20(ptToken).safeTransfer(borrower, amount)` → `IFlashBorrower.onFlashLoan()` → `IERC20(ptToken).safeTransferFrom(borrower, vault, amount)` → `IERC20(underlying).safeTransferFrom(borrower, treasury, fee)` |
| State modified | None (atomic loan, repaid in same tx) |
| Value flow | PT: vault → borrower → vault (round-trip); underlying: borrower → treasury (fee, in) |
| Reentrancy guard | yes |

### `OVRFLOBook.postOffer(address market, uint16 aprBps, uint128 capacity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Liquidity provider |
| Parameters | market (user-controlled), aprBps (user-controlled), capacity (user-controlled) |
| Call chain | `→ _validateApr()` → `StreamPricing.marketActive()` → `_pullExact(underlying, msg.sender, book, capacity)` |
| State modified | `offers[offerId] = {...}`, `nextOfferId++` |
| Value flow | underlying: msg.sender → book (in) |
| Reentrancy guard | yes |

### `OVRFLOBook.sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Stream owner (seller) |
| Parameters | offerId (user-controlled), streamId (user-controlled), minNetOut (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible()` → `StreamPricing.grossPrice()` → `Sablier.transferFrom(seller→maker)` → `_payUnderlying(seller, net)` → `_payUnderlying(treasury, fee)` |
| State modified | `offer.capacity -= grossPrice`, `offer.active = false` if capacity == 0 |
| Value flow | stream NFT: seller → maker (transfer); underlying: book → seller (net out) + book → treasury (fee out) |
| Reentrancy guard | yes |

### `OVRFLOBook.postSaleListing(address market, uint256 streamId, uint16 aprBps)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Stream owner |
| Parameters | market (user-controlled), streamId (user-controlled), aprBps (user-controlled) |
| Call chain | `→ _validateApr()` → `StreamPricing.requireEligible()` → `Sablier.transferFrom(seller→book)` |
| State modified | `saleListings[listingId] = {...}`, `nextSaleListingId++` |
| Value flow | stream NFT: msg.sender → book (escrow, in) |
| Reentrancy guard | yes |

### `OVRFLOBook.buyListing(uint256 listingId, uint256 maxPriceIn)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Buyer |
| Parameters | listingId (user-controlled), maxPriceIn (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible()` → `StreamPricing.grossPrice()` → `_pullExact(underlying, buyer, book, grossPrice)` → `_payUnderlying(maker, net)` → `_payUnderlying(treasury, fee)` → `Sablier.transferFrom(book→buyer)` |
| State modified | `listing.active = false` |
| Value flow | underlying: buyer → book (in); underlying: book → seller (net out) + book → treasury (fee out); stream NFT: book → buyer (out) |
| Reentrancy guard | yes |

### `OVRFLOBook.closeLoan(uint256 loanId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (permissionless) |
| Parameters | loanId (user-controlled) |
| Call chain | `→ Sablier.withdrawableAmountOf()` → `Sablier.withdraw(stream, book, outstanding)` → `Sablier.transferFrom(book→borrower)` |
| State modified | `loan.closed = true`, `loan.drawn += outstanding`, `poolProceeds[poolId] += outstanding` |
| Value flow | ovrfloToken: stream → book (drawn, in); stream NFT: book → borrower (out) |
| Reentrancy guard | yes |

### `OVRFLOBook.createBorrowPool(uint256[] offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Borrower (stream owner) |
| Parameters | offerIds (user-controlled), streamId (user-controlled), targetBorrow (user-controlled), minAcceptable (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible()` → `StreamPricing.grossPrice()` → `_validateOffers()` → `StreamPricing.obligationForFill()` → `StreamPricing.fee()` → `_consumeOffers()` → `_storeLoan()` → `Sablier.transferFrom(borrower→book)` → `_payUnderlying(borrower, net)` → `_payUnderlying(treasury, fee)` |
| State modified | `pools[poolId]`, `poolContributions[poolId][maker]` per offer, `offers[i].capacity` decremented, `loans[loanId]`, `loanPoolId`, `poolLoanId`, `nextPoolId++`, `nextLoanId++` |
| Value flow | underlying: book → borrower (net out) + book → treasury (fee out); stream NFT: borrower → book (escrow, in) |
| Reentrancy guard | yes |

---

## Role-Gated

### Offer Maker

#### `OVRFLOBook.cancelOffer(uint256 offerId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Offer maker (`offer.maker == msg.sender`) |
| Parameters | offerId (user-controlled) |
| State modified | `offer.capacity = 0`, `offer.active = false` |
| Value flow | underlying: book → maker (refund, out) |
| Reentrancy guard | yes |

### Listing Maker

#### `OVRFLOBook.cancelSaleListing(uint256 listingId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Listing maker (`listing.maker == msg.sender`) |
| Parameters | listingId (user-controlled) |
| State modified | `listing.active = false` |
| Value flow | stream NFT: book → maker (return, out) |
| Reentrancy guard | yes |

### Borrower

#### `OVRFLOBook.repayLoan(uint256 loanId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Loan borrower (`loan.borrower == msg.sender`) |
| Parameters | loanId (user-controlled), amount (user-controlled) |
| State modified | `loan.repaid += amount`, `loan.closed = true` if amount == outstanding |
| Value flow | ovrfloToken: borrower → book (in); stream NFT: book → borrower (out, if closed) |
| Reentrancy guard | yes |

### Pool Contributor

#### `OVRFLOBook.poolClaimLoan(uint256 poolId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Pool contributor (`poolContributions[poolId][msg.sender] > 0`) |
| Parameters | poolId (user-controlled), amount (user-controlled) |
| State modified | `poolReceived[poolId][msg.sender] += drawAmount`, `loan.drawn += drawAmount` |
| Value flow | ovrfloToken: stream → contributor (direct draw, out) |
| Reentrancy guard | yes |

#### `OVRFLOBook.claimPoolShare(uint256 poolId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Pool contributor (`poolContributions[poolId][msg.sender] > 0`) |
| Parameters | poolId (user-controlled), amount (user-controlled) |
| State modified | `poolReceived[poolId][msg.sender] += amount`, `poolProceeds[poolId] -= amount` |
| Value flow | ovrfloToken: book → contributor (out) |
| Reentrancy guard | yes |

---

## Admin-Only

### OVRFLOFactory (onlyOwner — timelocked multisig)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOFactory | `configureDeployment()` | treasury, underlying, nameSuffix, symbolSuffix | `pendingDeployment` |
| OVRFLOFactory | `cancelDeployment()` | — | `delete pendingDeployment` |
| OVRFLOFactory | `deploy()` | — | `ovrflos[]`, `ovrfloInfo[]`, `underlyingToOvrflo[]`, `ovrfloCount` |
| OVRFLOFactory | `deployBook()` | ovrflo | `ovrfloToBook[]`, `bookToOvrflo[]`, `books[]`, `bookCount` |
| OVRFLOFactory | `addMarket()` | ovrflo, market, twapDuration, feeBps | `isMarketApproved[]`, `approvedMarketAt[]`, `approvedMarketCount` |
| OVRFLOFactory | `setMarketDepositLimit()` | ovrflo, market, limit | `vault.marketDepositLimits[market]` |
| OVRFLOFactory | `sweepExcessPt()` | ovrflo, ptToken, to | Sends excess PT to `to` |
| OVRFLOFactory | `sweepExcessUnderlying()` | ovrflo, to | Sends excess underlying to `to` |
| OVRFLOFactory | `setFlashFeeBps()` | ovrflo, feeBps | `vault.flashFeeBps` |
| OVRFLOFactory | `setFlashLoanPaused()` | ovrflo, paused | `vault.flashLoanPaused` |
| OVRFLOFactory | `prepareOracle()` | market, twapDuration | Pendle market cardinality |
| OVRFLOFactory | `setBookAprBounds()` | book, aprMinBps, aprMaxBps | `book.aprMinBps`, `book.aprMaxBps` |
| OVRFLOFactory | `setBookFee()` | book, feeBps | `book.feeBps` |
| OVRFLOFactory | `setBookTreasury()` | book, treasury | `book.treasury` |

### OVRFLO (onlyAdmin — factory is admin)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLO | `setSeriesApproved()` | market, pt, twapDuration, expiry, feeBps | `_series[market]`, `ptToMarket[pt]` |
| OVRFLO | `setMarketDepositLimit()` | market, limit | `marketDepositLimits[market]` |
| OVRFLO | `sweepExcessPt()` | ptToken, to | Sends excess PT to `to` |
| OVRFLO | `sweepExcessUnderlying()` | to | Sends excess underlying to `to` |
| OVRFLO | `setFlashFeeBps()` | feeBps | `flashFeeBps` |
| OVRFLO | `setFlashLoanPaused()` | paused | `flashLoanPaused` |

### OVRFLOBook (onlyOwner — factory is owner)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOBook | `setAprBounds()` | aprMinBps, aprMaxBps | `aprMinBps`, `aprMaxBps` |
| OVRFLOBook | `setFee()` | feeBps | `feeBps` |
| OVRFLOBook | `setTreasury()` | treasury | `treasury` |

### OVRFLOToken (onlyOwner — OVRFLO vault is owner)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOToken | `transferOwnership()` | newOwner | `owner` |
| OVRFLOToken | `mint()` | to, amount | `balanceOf[to]`, `totalSupply` |
| OVRFLOToken | `burn()` | from, amount | `balanceOf[from]`, `totalSupply` |
