# Entry Point Map

> OVRFLO | 35 entry points | 10 permissionless | 7 role-gated | 18 admin-only

---

## Protocol Flow Paths

### Setup (Multisig)

`configureDeployment()` -> `deploy()` -> `deployLending()` -> `addMarket()`  ◄── `prepareOracle()` may be needed first if cardinality insufficient

### Depositor Flow

`[addMarket above]` -> `User.deposit()` -> (maturity passes) -> `User.claim()`
                                     └─> `User.unwrap()`  ◄── requires wrap reserve funded by someone's `wrap()`

### Wrapper Flow

`[deploy above]` -> `User.wrap()` -> `User.unwrap()`

### Lender Flow

`[addMarket above]` -> `Lender.supplyLiquidity()` -> `Lender.withdrawLiquidity()`  ◄── refund remaining
                                          └─> `Seller.sellStreamToLiquidity()`  ◄── consumes liquidity

### Seller Flow

`[addMarket above]` -> `Seller.postSaleListing()` -> `Seller.cancelSaleListing()` or `Buyer.buyListing()`

### Borrower Flow

`[addMarket above]` + `[Lender.supplyLiquidity above]` -> `Borrower.createBorrowerLoanPool()`  ◄── gatherLiquidity() to find IDs
                                                          ├─> `Borrower.repayLoan()`  ◄── role-gated by loan.borrower
                                                          └─> `Anyone.closeLoan()` -> `Lender.claimLoanPoolShare()`  ◄── role-gated by contribution

### Flash Loan Flow

`[addMarket above]` -> `Borrower.flashLoan()` -> (callback deposits/wraps/swaps) -> pullback + fee

---

## Permissionless

### `OVRFLO.wrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, (no nonReentrant) |
| Caller | Anyone (user wrapping underlying) |
| Parameters | `amount` (user-controlled) |
| Call chain | `-> OVRFLOToken.mint(user, amount)` |
| State modified | `wrappedUnderlying += amount` |
| Value flow | underlying: user -> vault; ovrfloToken: mint to user |
| Reentrancy guard | no |

### `OVRFLO.unwrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone holding ovrfloToken |
| Parameters | `amount` (user-controlled) |
| Call chain | `-> OVRFLOToken.burn(user, amount) -> IERC20(underlying).safeTransfer(user, amount)` |
| State modified | `wrappedUnderlying -= amount` |
| Value flow | ovrfloToken: burn from user; underlying: vault -> user |
| Reentrancy guard | no |

### `OVRFLO.claim(address ptToken, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone holding ovrfloToken, post-maturity |
| Parameters | `ptToken` (user-controlled), `amount` (user-controlled) |
| Call chain | `-> OVRFLOToken.burn(user, amount) -> IERC20(ptToken).safeTransfer(user, amount)` |
| State modified | `marketTotalDeposited[market] -= amount` |
| Value flow | ovrfloToken: burn; PT: vault -> user |
| Reentrancy guard | no |

### `OVRFLO.flashLoan(address ptToken, uint256 amount, bytes data)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (flash borrower contract) |
| Parameters | `ptToken` (user-controlled), `amount` (user-controlled), `data` (user-controlled) |
| Call chain | `-> IFlashBorrower(msg.sender).onFlashLoan(...) -> IERC20(pt).safeTransferFrom(borrower, this, amount) -> IERC20(underlying).safeTransferFrom(borrower, TREASURY, fee)` |
| State modified | none (transient loan; no storage delta) |
| Value flow | PT: vault -> borrower -> vault; underlying fee: borrower -> treasury |
| Reentrancy guard | yes |

### `OVRFLOLending.supplyLiquidity(address market, uint16 aprBps, uint128 availableLiquidity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (lender) |
| Parameters | `market` (user-controlled), `aprBps` (user-controlled), `availableLiquidity` (user-controlled) |
| Call chain | `-> StreamPricing.marketActive(core, market) -> _pullExact(underlying, lender, this, availableLiquidity)` |
| State modified | `liquidityPositions[id] = {...}; nextLiquidityId++` |
| Value flow | underlying: lender -> lending contract |
| Reentrancy guard | yes |

### `OVRFLOLending.sellStreamToLiquidity(uint256 liquidityId, uint256 streamId, uint256 minNetOut)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone owning the Sablier stream NFT |
| Parameters | `liquidityId` (user-controlled), `streamId` (user-controlled), `minNetOut` (user-controlled) |
| Call chain | `-> _priceStream -> StreamPricing.requireEligible -> sablier.transferFrom(seller, lender, streamId) -> _payUnderlying(seller, net) -> _payUnderlying(treasury, fee)` |
| State modified | `liquidityPositions[id].availableLiquidity -= grossPrice` |
| Value flow | stream NFT: seller -> lender; underlying: lending -> seller (net) + treasury (fee) |
| Reentrancy guard | yes |

### `OVRFLOLending.postSaleListing(address market, uint256 streamId, uint16 aprBps)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone owning the stream |
| Parameters | `market` (user-controlled), `streamId` (user-controlled), `aprBps` (user-controlled) |
| Call chain | `-> _requireEligible -> sablier.transferFrom(seller, this, streamId)` |
| State modified | `saleListings[id] = {...}; nextSaleListingId++` |
| Value flow | stream NFT: seller -> lending (escrow) |
| Reentrancy guard | yes |

### `OVRFLOLending.buyListing(uint256 listingId, uint256 maxPriceIn)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (buyer) |
| Parameters | `listingId` (user-controlled), `maxPriceIn` (user-controlled) |
| Call chain | `-> _priceStream -> _pullExact(underlying, buyer, this, grossPrice) -> _payUnderlying(seller, net) -> _payUnderlying(treasury, fee) -> sablier.transferFrom(this, buyer, streamId)` |
| State modified | `saleListings[id].active = false` |
| Value flow | underlying: buyer -> seller (net) + treasury (fee); stream NFT: lending -> buyer |
| Reentrancy guard | yes |

### `OVRFLOLending.closeLoan(uint256 loanId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (permissionless) |
| Parameters | `loanId` (user-controlled) |
| Call chain | `-> sablier.withdrawableAmountOf -> sablier.withdraw(streamId, this, outstanding) -> sablier.transferFrom(this, borrower, streamId)` |
| State modified | `loan.closed = true; loan.drawn += outstanding; loanPoolProceeds[loanId] += outstanding` |
| Value flow | ovrfloToken: stream -> lending (proceeds); stream NFT: lending -> borrower |
| Reentrancy guard | yes |

### `OVRFLOLending.createBorrowerLoanPool(uint256[] liquidityIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | Anyone (borrower) |
| Parameters | `liquidityIds` (user-controlled), `streamId` (user-controlled), `targetBorrow` (user-controlled), `minAcceptable` (user-controlled) |
| Call chain | `-> _validateLiquidity -> _priceStream -> StreamPricing.obligationForFill -> _storeLoan -> _consumeLiquidity -> sablier.transferFrom(borrower, this, streamId) -> _payUnderlying(borrower, net) -> _payUnderlying(treasury, fee)` |
| State modified | `loans[id]; loanPools[id]; loanPoolContributions[id][lender]; liquidityPositions[*].availableLiquidity; nextLoanId++` |
| Value flow | underlying: liquidity -> borrower (net) + treasury (fee); stream NFT: borrower -> lending (escrow) |
| Reentrancy guard | yes |

---

## Role-Gated

### `LiquidityPosition.lender` (by ownership)

#### `OVRFLOLending.withdrawLiquidity(uint256 liquidityId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | `liquidity.lender == msg.sender` |
| Parameters | `liquidityId` (user-controlled) |
| Call chain | `-> _payUnderlying(lender, refund)` |
| State modified | `liquidityPositions[id].availableLiquidity = 0` |
| Value flow | underlying: lending -> lender |
| Reentrancy guard | yes |

### `SaleListing.seller` (by ownership)

#### `OVRFLOLending.cancelSaleListing(uint256 listingId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | `listing.seller == msg.sender` |
| Parameters | `listingId` (user-controlled) |
| Call chain | `-> sablier.transferFrom(this, seller, streamId)` |
| State modified | `saleListings[id].active = false` |
| Value flow | stream NFT: lending -> seller |
| Reentrancy guard | yes |

### `Loan.borrower` (by ownership)

#### `OVRFLOLending.repayLoan(uint256 loanId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | `loan.borrower == msg.sender` |
| Parameters | `loanId` (user-controlled), `amount` (user-controlled) |
| Call chain | `-> _pullExact(ovrfloToken, borrower, this, amount) -> (if closes) sablier.transferFrom(this, borrower, streamId)` |
| State modified | `loan.repaid += amount; loan.closed = true (if amount == outstanding); loanPoolProceeds[loanId] += amount` |
| Value flow | ovrfloToken: borrower -> lending; (if closes) stream NFT: lending -> borrower |
| Reentrancy guard | yes |

### `loanPoolContributions[loanId][account] > 0` (by contribution)

#### `OVRFLOLending.claimLoanPoolShare(uint256 loanId, uint128 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `nonReentrant` |
| Caller | `contribution > 0` (lender) |
| Parameters | `loanId` (user-controlled), `amount` (user-controlled) |
| Call chain | `-> _claimFair -> (if open && deficit) sablier.withdraw -> IERC20(ovrfloToken).safeTransfer(account, payAmount)` |
| State modified | `loanPoolReceived[loanId][account] += payAmount; loanPoolProceeds[loanId] -= payAmount; (if harvest) loan.drawn += harvestAmount` |
| Value flow | ovrfloToken: lending -> lender |
| Reentrancy guard | yes |

### `OVRFLOToken.owner` (the vault)

#### `OVRFLOToken.transferOwnership(address newOwner)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `onlyOwner` |
| Caller | vault (set once by factory at deploy) |
| Parameters | `newOwner` (vault-controlled) |
| State modified | `owner = newOwner` |

#### `OVRFLOToken.mint(address to, uint256 amount)` / `OVRFLOToken.burn(address from, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, `onlyOwner` |
| Caller | vault only |
| Parameters | `to`/`from` (vault-controlled), `amount` (vault-controlled) |
| State modified | ERC20 balances + totalSupply |

### `OVRFLO.onlyAdmin` (= factory)

#### `OVRFLO.setSeriesApproved / setMarketDepositLimit / sweepExcessPt / sweepExcessUnderlying / setFlashFeeBps / setFlashLoanPaused`

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLO | `setSeriesApproved(market, pt, twapDuration, expiry, feeBps)` | market config | `_series[market]; ptToMarket[pt]` |
| OVRFLO | `setMarketDepositLimit(market, limit)` | limit | `marketDepositLimits[market]` |
| OVRFLO | `sweepExcessPt(ptToken, to)` | PT + recipient | PT transfer out (excess only) |
| OVRFLO | `sweepExcessUnderlying(to)` | recipient | underlying transfer out (excess only) |
| OVRFLO | `setFlashFeeBps(feeBps)` | fee | `flashFeeBps` |
| OVRFLO | `setFlashLoanPaused(paused)` | bool | `flashLoanPaused` |

---

## Admin-Only

### `OVRFLOFactory.onlyOwner` (= timelocked multisig)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOFactory | `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | deploy params | `pendingDeployment` |
| OVRFLOFactory | `cancelDeployment()` | — | deletes `pendingDeployment` |
| OVRFLOFactory | `deploy()` | — | deploys OVRFLOToken + OVRFLO; `ovrflos; ovrfloInfo; underlyingToOvrflo` |
| OVRFLOFactory | `deployLending(ovrflo)` | vault addr | deploys OVRFLOLending; `ovrfloToLending; lendingToOvrflo; lendings` |
| OVRFLOFactory | `addMarket(ovrflo, market, twapDuration, feeBps)` | market config | `isMarketApproved; approvedMarketAt; approvedMarketCount` + vault.setSeriesApproved |
| OVRFLOFactory | `setMarketDepositLimit(ovrflo, market, limit)` | limit | vault.marketDepositLimits |
| OVRFLOFactory | `sweepExcessPt(ovrflo, ptToken, to)` | PT + recipient | vault.sweepExcessPt |
| OVRFLOFactory | `sweepExcessUnderlying(ovrflo, to)` | recipient | vault.sweepExcessUnderlying |
| OVRFLOFactory | `setFlashFeeBps(ovrflo, feeBps)` | fee | vault.flashFeeBps |
| OVRFLOFactory | `setFlashLoanPaused(ovrflo, paused)` | bool | vault.flashLoanPaused |
| OVRFLOFactory | `prepareOracle(market, twapDuration)` | oracle config | Pendle market cardinality |
| OVRFLOFactory | `setLendingAprBounds(lending, aprMin, aprMax)` | APR bounds | lending.aprMinBps/aprMaxBps |
| OVRFLOFactory | `setLendingFee(lending, feeBps)` | fee | lending.feeBps |
| OVRFLOFactory | `setLendingTreasury(lending, treasury)` | treasury | lending.treasury |

### `OVRFLOLending.onlyOwner` (= factory, forwarded from multisig)

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOLending | `setAprBounds(aprMinBps_, aprMaxBps_)` | APR bounds | `aprMinBps; aprMaxBps` |
| OVRFLOLending | `setFee(feeBps_)` | fee | `feeBps` |
| OVRFLOLending | `setTreasury(treasury_)` | treasury | `treasury` |
