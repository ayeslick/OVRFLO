# Entry Point Map

> OVRFLO | 36 entry points | 11 permissionless | 4 role-gated | 21 admin-only

---

## Protocol Flow Paths

### Setup (Multisig)

`configureDeployment()` → `deploy()` → `deployBook()` → `addMarket()` ◄── `prepareOracle()` first if cardinality insufficient

### User: Deposit & Exit

`[setup above]` → `OVRFLO.deposit()` → `OVRFLO.claim()` ◄── after maturity
                           ├─→ `OVRFLO.wrap()` ◄── alternative: wrap underlying 1:1
                           └─→ `OVRFLO.unwrap()` ◄── exit ovrfloToken for underlying

### User: Stream Trading

`[deposit above]` → `OVRFLOBook.postOffer()` → `OVRFLOBook.sellIntoOffer()` ◄── another user sells into offer
                   ├─→ `OVRFLOBook.postSaleListing()` → `OVRFLOBook.buyListing()` ◄── another user buys
                   └─→ `OVRFLOBook.createBorrowPool()` ◄── borrower pledges stream
                                          ├─→ `OVRFLOBook.closeLoan()` ◄── permissionless, when stream accrues
                                          ├─→ `OVRFLOBook.repayLoan()` ◄── borrower repays early
                                          └─→ `OVRFLOBook.claimPoolShare()` ◄── contributor claims proceeds

### Maintenance (Multisig via Factory)

`[setup above]` → `OVRFLOFactory.setMarketDepositLimit()` / `setFlashLoanPaused()` / `sweepExcessPt()` / `setBookFee()` / `setBookAprBounds()`

---

## Permissionless

### `OVRFLO.wrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no modifier |
| Caller | Anyone with underlying tokens |
| Parameters | amount (user-controlled) |
| Call chain | `→ IERC20(underlying).safeTransferFrom() → OVRFLOToken.mint()` |
| State modified | `wrappedUnderlying += amount` |
| Value flow | underlying: user → vault; ovrfloToken: vault → user |
| Reentrancy guard | no |

### `OVRFLO.unwrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no modifier |
| Caller | Anyone with ovrfloToken |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20(underlying).safeTransfer()` |
| State modified | `wrappedUnderlying -= amount` |
| Value flow | ovrfloToken burned; underlying: vault → user |
| Reentrancy guard | no |

### `OVRFLO.deposit(address market, uint256 ptAmount, uint256 minToUser)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no modifier |
| Caller | Anyone with approved PT tokens |
| Parameters | market (user-controlled), ptAmount (user-controlled), minToUser (user-controlled) |
| Call chain | `→ IPendleOracle.getOracleState() → IERC20(ptToken).safeTransferFrom() → IPendleOracle.getPtToSyRate() → OVRFLOToken.mint() ×2 → ISablierV2LockupLinear.createWithDurations()` |
| State modified | `marketTotalDeposited[market] += ptAmount` |
| Value flow | PT: user → vault; underlying fee: user → treasury; ovrfloToken: minted to user + vault; Sablier stream created |
| Reentrancy guard | no |

### `OVRFLO.claim(address ptToken, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no modifier |
| Caller | Anyone with ovrfloToken after maturity |
| Parameters | ptToken (user-controlled), amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20(ptToken).safeTransfer()` |
| State modified | `marketTotalDeposited[market] -= amount` |
| Value flow | ovrfloToken burned; PT: vault → user |
| Reentrancy guard | no |

### `OVRFLO.flashLoan(address ptToken, uint256 amount, bytes calldata data)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone implementing IFlashBorrower |
| Parameters | ptToken (user-controlled), amount (user-controlled), data (user-controlled) |
| Call chain | `→ IERC20(ptToken).safeTransfer() → IFlashBorrower(msg.sender).onFlashLoan() → IERC20(ptToken).safeTransferFrom() → IERC20(underlying).safeTransferFrom()` |
| State modified | none (balanced in/out) |
| Value flow | PT: vault → borrower → vault; fee: borrower → treasury |
| Reentrancy guard | yes |

### `OVRFLOBook.postOffer(address market, uint16 aprBps, uint128 capacity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone with underlying liquidity |
| Parameters | market (user-controlled), aprBps (user-controlled), capacity (user-controlled) |
| Call chain | `→ StreamPricing.marketActive() → _pullExact(IERC20(underlying), maker, book, capacity)` |
| State modified | `nextOfferId++`, `offers[offerId] = new Offer` |
| Value flow | underlying: maker → book |
| Reentrancy guard | yes |

### `OVRFLOBook.sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone owning an eligible Sablier stream |
| Parameters | offerId (user-controlled), streamId (user-controlled), minNetOut (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → StreamPricing.grossPrice() → ISablierV2LockupLinear.transferFrom() → _payUnderlying()` |
| State modified | `offer.capacity -= grossPrice`, `offer.active = false` (if 0) |
| Value flow | stream: seller → offer maker; underlying: book → seller + treasury |
| Reentrancy guard | yes |

### `OVRFLOBook.postSaleListing(address market, uint256 streamId, uint16 aprBps)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone owning an eligible Sablier stream |
| Parameters | market (user-controlled), streamId (user-controlled), aprBps (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → ISablierV2LockupLinear.transferFrom(seller, book, streamId)` |
| State modified | `nextSaleListingId++`, `saleListings[listingId] = new SaleListing` (feeBps snapshotted) |
| Value flow | stream: maker → book (escrow) |
| Reentrancy guard | yes |

### `OVRFLOBook.buyListing(uint256 listingId, uint256 maxPriceIn)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone with underlying to buy a listed stream |
| Parameters | listingId (user-controlled), maxPriceIn (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → StreamPricing.grossPrice() → _pullExact(underlying, buyer, book) → _payUnderlying(seller) → _payUnderlying(treasury) → ISablierV2LockupLinear.transferFrom(book, buyer, streamId)` |
| State modified | `listing.active = false` |
| Value flow | underlying: buyer → seller + treasury; stream: book → buyer |
| Reentrancy guard | yes |

### `OVRFLOBook.createBorrowPool(uint256[] offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone owning an eligible stream who wants to borrow |
| Parameters | offerIds (user-controlled), streamId (user-controlled), targetBorrow (user-controlled), minAcceptable (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → StreamPricing.grossPrice() → StreamPricing.obligationForFill() → _validateOffers() → _consumeOffers() → _storeLoan() → ISablierV2LockupLinear.transferFrom() → _payUnderlying()` |
| State modified | `nextPoolId++`, `pools[poolId]`, `poolContributions[poolId][maker]`, `nextLoanId++`, `loans[loanId]`, `loanPoolId[loanId]`, `poolLoanId[poolId]`, `offer.capacity -= consumed` |
| Value flow | stream: borrower → book (escrow); underlying: book → borrower + treasury |
| Reentrancy guard | yes |

### `OVRFLOBook.closeLoan(uint256 loanId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (permissionless) |
| Parameters | loanId (user-controlled) |
| Call chain | `→ ISablierV2LockupLinear.withdraw() → ISablierV2LockupLinear.transferFrom(book, borrower, streamId)` |
| State modified | `loan.closed = true`, `loan.drawn += outstanding`, `poolProceeds[poolId] += outstanding` |
| Value flow | ovrfloToken: stream → book (proceeds); stream: book → borrower |
| Reentrancy guard | yes |

---

## Role-Gated

### Offer Maker

#### `OVRFLOBook.cancelOffer(uint256 offerId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Offer maker only (`require(offer.maker == msg.sender)`) |
| Parameters | offerId (user-controlled) |
| Call chain | `→ _payUnderlying(maker, refund)` |
| State modified | `offer.capacity = 0`, `offer.active = false` |
| Value flow | underlying: book → maker |
| Reentrancy guard | yes |

### Listing Maker

#### `OVRFLOBook.cancelSaleListing(uint256 listingId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Listing maker only (`require(listing.maker == msg.sender)`) |
| Parameters | listingId (user-controlled) |
| Call chain | `→ ISablierV2LockupLinear.transferFrom(book, maker, streamId)` |
| State modified | `listing.active = false` |
| Value flow | stream: book → maker |
| Reentrancy guard | yes |

### Borrower

#### `OVRFLOBook.repayLoan(uint256 loanId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Loan borrower only (`require(loan.borrower == msg.sender)`) |
| Parameters | loanId (user-controlled), amount (user-controlled) |
| Call chain | `→ _pullExact(IERC20(ovrfloToken), borrower, book, amount) → ISablierV2LockupLinear.transferFrom(book, borrower, streamId)` (if closes) |
| State modified | `loan.repaid += amount`, `loan.closed = true` (if closes), `poolProceeds[poolId] += amount` |
| Value flow | ovrfloToken: borrower → book (proceeds); stream: book → borrower (if closes) |
| Reentrancy guard | yes |

### Pool Contributor

#### `OVRFLOBook.claimPoolShare(uint256 poolId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Pool contributor only (`require(contribution > 0)` via `_claimFair`) |
| Parameters | poolId (user-controlled), amount (user-controlled) |
| Call chain | `→ _claimFair() → ISablierV2LockupLinear.withdrawableAmountOf() → ISablierV2LockupLinear.withdraw() (if harvest needed) → IERC20(ovrfloToken).safeTransfer()` |
| State modified | `loan.drawn += harvestAmount` (if harvest), `poolProceeds[poolId] += harvestAmount` (if harvest), `poolReceived[poolId][account] += payAmount`, `poolProceeds[poolId] -= payAmount` |
| Value flow | ovrfloToken: book → contributor (from poolProceeds, possibly harvested from stream) |
| Reentrancy guard | yes |

---

## Admin-Only

### OVRFLOFactory (onlyOwner = timelocked multisig)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `configureDeployment()` | treasury, underlying, nameSuffix, symbolSuffix | `pendingDeployment` |
| `cancelDeployment()` | none | `delete pendingDeployment` |
| `deploy()` | none | `ovrflos[]`, `ovrfloInfo[]`, `underlyingToOvrflo[]`, `ovrfloCount` |
| `deployBook()` | ovrflo | `ovrfloToBook[]`, `bookToOvrflo[]`, `books[]`, `bookCount` |
| `addMarket()` | ovrflo, market, twapDuration, feeBps | `isMarketApproved[]`, `approvedMarketAt[]`, `approvedMarketCount` + vault `_series`, `ptToMarket` |
| `setMarketDepositLimit()` | ovrflo, market, limit | vault `marketDepositLimits[market]` |
| `sweepExcessPt()` | ovrflo, ptToken, to | vault PT balance → `to` |
| `sweepExcessUnderlying()` | ovrflo, to | vault underlying balance → `to` |
| `setFlashFeeBps()` | ovrflo, feeBps | vault `flashFeeBps` |
| `setFlashLoanPaused()` | ovrflo, paused | vault `flashLoanPaused` |
| `prepareOracle()` | market, twapDuration | Pendle market cardinality (external) |
| `setBookAprBounds()` | book, aprMin, aprMax | book `aprMinBps`, `aprMaxBps` |
| `setBookFee()` | book, feeBps | book `feeBps` |
| `setBookTreasury()` | book, treasury | book `treasury` |

### OVRFLO (onlyAdmin = factory)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setSeriesApproved()` | market, pt, twapDuration, expiry, feeBps | `_series[market]`, `ptToMarket[pt]` |
| `setMarketDepositLimit()` | market, limit | `marketDepositLimits[market]` |
| `sweepExcessPt()` | ptToken, to | PT balance → `to` |
| `sweepExcessUnderlying()` | to | underlying balance → `to` |
| `setFlashFeeBps()` | feeBps | `flashFeeBps` |
| `setFlashLoanPaused()` | paused | `flashLoanPaused` |

### OVRFLOBook (onlyOwner = factory)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setAprBounds()` | aprMinBps, aprMaxBps | `aprMinBps`, `aprMaxBps` |
| `setFee()` | feeBps | `feeBps` |
| `setTreasury()` | treasury | `treasury` |

### OVRFLOToken (onlyOwner = OVRFLO vault)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `transferOwnership()` | newOwner | `owner` |
| `mint()` | to, amount | `totalSupply`, `balanceOf[to]` |
| `burn()` | from, amount | `totalSupply`, `balanceOf[from]` |
