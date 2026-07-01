# Entry Point Map

> OVRFLO | 45 entry points | 12 permissionless | 7 role-gated | 26 admin-only

---

## Protocol Flow Paths

### Setup (Timelocked Multisig)

`OVRFLOFactory.configureDeployment()` → `OVRFLOFactory.deploy()` → `OVRFLOFactory.addMarket()` ◄── oracle cardinality must be prepared via `prepareOracle()`
→ `OVRFLOFactory.deployBook()` ◄── vault must exist first

### Deposit & Exit (User)

`[multisig setup above]` → `OVRFLO.deposit()` ◄── user must approve PT + underlying for fee
                                    ├─→ `OVRFLO.claim()` ◄── after maturity
                                    ├─→ `OVRFLO.wrap()` / `OVRFLO.unwrap()` ◄── permissionless, no maturity gate
                                    └─→ `OVRFLO.flashLoan()` ◄── pre-maturity only

### Stream Trading (User)

`[deposit above]` → `OVRFLOBook.postOffer()` → `OVRFLOBook.sellIntoOffer()` ◄── any seller with eligible stream
                  → `OVRFLOBook.postSaleListing()` → `OVRFLOBook.buyListing()` ◄── any buyer with underlying

### Stream Borrowing (User)

`[deposit above]` → `OVRFLOBook.postOffer()` ── unified offer, consumable as sale or loan
                                              ↓
                  `OVRFLOBook.createBorrowPool()` ◄── borrower pledges stream, consumes offers
                                              ↓
                  `OVRFLOBook.closeLoan()` ◄── permissionless, draws outstanding from stream
                  `OVRFLOBook.repayLoan()` ◄── borrower repays in ovrfloToken
                                              ↓
                  `OVRFLOBook.poolClaimLoan()` ◄── contributor draws directly from stream (loanId derived from poolId)
                  `OVRFLOBook.claimPoolShare()` ◄── contributor claims from poolProceeds

---

## Permissionless

### `OVRFLO.wrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | Any user with underlying to wrap |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.mint(msg.sender, amount)` |
| State modified | wrappedUnderlying += amount; OVRFLOToken totalSupply += amount |
| Value flow | underlying: sender → vault; ovrfloToken: vault → sender |
| Reentrancy guard | no |

### `OVRFLO.unwrap(uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | Any ovrfloToken holder |
| Parameters | amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn(msg.sender, amount)` → `IERC20(underlying).safeTransfer(msg.sender, amount)` |
| State modified | wrappedUnderlying -= amount; OVRFLOToken totalSupply -= amount |
| Value flow | ovrfloToken: sender → burn; underlying: vault → sender |
| Reentrancy guard | no |

### `OVRFLO.deposit(address market, uint256 ptAmount, uint256 minToUser)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | Any user with approved PT to deposit |
| Parameters | market (user-controlled), ptAmount (user-controlled), minToUser (user-controlled) |
| Call chain | `→ IPendleOracle(oracle).getPtToSyRate(market, twapDuration)` → `IERC20(ptToken).safeTransferFrom(user, vault, ptAmount)` → `IERC20(underlying).safeTransferFrom(user, treasury, fee)` → `OVRFLOToken.mint(user, toUser)` → `OVRFLOToken.mint(vault, toStream)` → `sablierLL.createWithDurations(...)` |
| State modified | marketTotalDeposited[market] += ptAmount; OVRFLOToken totalSupply += ptAmount; Sablier stream created |
| Value flow | PT: sender → vault; underlying (fee): sender → treasury; ovrfloToken: mint → sender + vault(Sablier) |
| Reentrancy guard | no |

### `OVRFLO.claim(address ptToken, uint256 amount)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | Any ovrfloToken holder, post-maturity |
| Parameters | ptToken (user-controlled), amount (user-controlled) |
| Call chain | `→ OVRFLOToken.burn(msg.sender, amount)` → `IERC20(ptToken).safeTransfer(msg.sender, amount)` |
| State modified | marketTotalDeposited[market] -= amount; OVRFLOToken totalSupply -= amount |
| Value flow | ovrfloToken: sender → burn; PT: vault → sender |
| Reentrancy guard | no |

### `OVRFLO.flashLoan(address ptToken, uint256 amount, bytes calldata data)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any flash borrower contract implementing IFlashBorrower |
| Parameters | ptToken (user-controlled), amount (user-controlled), data (user-controlled) |
| Call chain | `→ IPendleOracle(oracle).getPtToSyRate(market, twapDuration)` → `IERC20(ptToken).safeTransfer(borrower, amount)` → `IFlashBorrower(borrower).onFlashLoan(...)` → `IERC20(ptToken).safeTransferFrom(borrower, vault, amount)` → `IERC20(underlying).safeTransferFrom(borrower, treasury, fee)` |
| State modified | None (PT sent out and pulled back; fee transferred to treasury) |
| Value flow | PT: vault → borrower → vault (round-trip); underlying (fee): borrower → treasury |
| Reentrancy guard | yes (nonReentrant on flashLoan; but deposit/wrap/unwrap are unguarded) |

### `OVRFLOBook.postOffer(address market, uint16 aprBps, uint128 capacity)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any user with underlying to fund a standing offer |
| Parameters | market (user-controlled), aprBps (user-controlled), capacity (user-controlled) |
| Call chain | `→ StreamPricing.marketActive(factory, core, market)` → `IERC20(underlying).safeTransferFrom(maker, book, capacity)` |
| State modified | offers[offerId] created; nextOfferId++ |
| Value flow | underlying: sender → book |
| Reentrancy guard | yes |

### `OVRFLOBook.sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any stream holder selling into a standing offer |
| Parameters | offerId (user-controlled), streamId (user-controlled), minNetOut (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible(factory, sablier, core, market, streamId)` → `StreamPricing.grossPrice(remaining, aprBps, ttm)` → `sablier.transferFrom(seller, maker, streamId)` → `IERC20(underlying).safeTransfer(seller, netToSeller)` → `IERC20(underlying).safeTransfer(treasury, fee)` |
| State modified | offer.capacity -= grossPrice; offer.active = false if capacity == 0 |
| Value flow | stream: seller → maker; underlying: book → seller (net) + treasury (fee) |
| Reentrancy guard | yes |

### `OVRFLOBook.postSaleListing(address market, uint256 streamId, uint16 aprBps)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any stream holder listing for sale |
| Parameters | market (user-controlled), streamId (user-controlled), aprBps (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible(factory, sablier, core, market, streamId)` → `sablier.transferFrom(maker, book, streamId)` |
| State modified | saleListings[listingId] created (with snapshotted feeBps); nextSaleListingId++ |
| Value flow | stream: sender → book (escrow) |
| Reentrancy guard | yes |

### `OVRFLOBook.buyListing(uint256 listingId, uint256 maxPriceIn)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any buyer with underlying |
| Parameters | listingId (user-controlled), maxPriceIn (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible(factory, sablier, core, market, streamId)` → `StreamPricing.grossPrice(...)` → `IERC20(underlying).safeTransferFrom(buyer, book, grossPrice)` → `IERC20(underlying).safeTransfer(maker, netToSeller)` → `IERC20(underlying).safeTransfer(treasury, fee)` → `sablier.transferFrom(book, buyer, streamId)` |
| State modified | listing.active = false |
| Value flow | underlying: buyer → maker (net) + treasury (fee); stream: book → buyer |
| Reentrancy guard | yes |

### `OVRFLOBook.closeLoan(uint256 loanId)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (permissionless) |
| Parameters | loanId (user-controlled) |
| Call chain | `→ sablier.withdrawableAmountOf(streamId)` → `sablier.withdraw(streamId, book, outstanding)` → `sablier.transferFrom(book, borrower, streamId)` |
| State modified | loan.closed = true; loan.drawn += outstanding; poolProceeds[poolId] += outstanding |
| Value flow | ovrfloToken: stream → book (poolProceeds); stream: book → borrower |
| Reentrancy guard | yes |

### `OVRFLOBook.createBorrowPool(uint256[] offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any stream holder borrowing against multiple offers |
| Parameters | offerIds (user-controlled), streamId (user-controlled), targetBorrow (user-controlled), minAcceptable (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible(...)` → `StreamPricing.grossPrice(...)` → `_validateOffers(...)` → `StreamPricing.obligationForFill(...)` → `_consumeOffers(...)` → `_storeLoan(...)` → `sablier.transferFrom(borrower, book, streamId)` → `IERC20(underlying).safeTransfer(borrower, netToBorrower)` → `IERC20(underlying).safeTransfer(treasury, fee)` |
| State modified | pools[poolId] created; loan created; offer capacities decremented; poolContributions recorded; loanPoolId/poolLoanId set; nextPoolId++ |
| Value flow | stream: sender → book (escrow); underlying: book → sender (net) + treasury (fee) |
| Reentrancy guard | yes |

### `OVRFLOBook.multicall(bytes[] calldata data)` (inherited from Multicall)

| Aspect | Detail |
|--------|--------|
| Visibility | external, no reentrancy guard |
| Caller | Any user |
| Parameters | data (user-controlled) |
| Call chain | `→ delegatecall` to each function in data array |
| State modified | Depends on called functions |
| Value flow | Depends on called functions |
| Reentrancy guard | no (but individual called functions may have nonReentrant) |

---

## Role-Gated

| Contract | Function | Access Check | State Modified | Value Flow |
|----------|----------|-------------|----------------|------------|
| OVRFLOBook | `cancelOffer(offerId)` | offer.maker == msg.sender | offer.active=false, offer.capacity=0 | underlying: book → maker |
| OVRFLOBook | `cancelSaleListing(listingId)` | listing.maker == msg.sender | listing.active=false | stream: book → maker |
| OVRFLOBook | `repayLoan(loanId, amount)` | loan.borrower == msg.sender | loan.repaid += amount; poolProceeds += amount; loan.closed if repaid == outstanding | ovrfloToken: borrower → book (poolProceeds); stream: book → borrower (if closed) |
| OVRFLOBook | `poolClaimLoan(poolId, amount)` | poolContributions[poolId][msg.sender] > 0 | poolReceived += drawAmount; loan.drawn += drawAmount | ovrfloToken: stream → caller (direct) |
| OVRFLOBook | `claimPoolShare(poolId, amount)` | poolContributions[poolId][msg.sender] > 0 | poolReceived += amount; poolProceeds -= amount | ovrfloToken: book → caller |

### Inherited (Ownable2Step)

| Contract | Function | Access | Note |
|----------|----------|--------|------|
| OVRFLOFactory | `acceptOwnership()` | pending owner only | Two-step ownership transfer completion |
| OVRFLOBook | `acceptOwnership()` | pending owner only | Two-step ownership transfer completion |

---

## Admin-Only

All admin functions flow through the timelocked multisig → OVRFLOFactory → target contract. OVRFLO admin functions use `onlyAdmin` (factory), OVRFLOBook uses `onlyOwner` (factory), OVRFLOToken uses `onlyOwner` (OVRFLO vault).

### OVRFLOFactory (onlyOwner = timelocked multisig)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | treasury, underlying, name/suffix strings | pendingDeployment set |
| `cancelDeployment()` | none | pendingDeployment deleted |
| `deploy()` | none | OVRFLO + OVRFLOToken deployed; ovrflos/ovrfloInfo/underlyingToOvrflo populated |
| `deployBook(ovrflo)` | vault address | OVRFLOBook deployed; ovrfloToBook/bookToOvrflo/books populated |
| `addMarket(ovrflo, market, twapDuration, feeBps)` | vault, market, TWAP duration, fee | OVRFLO.setSeriesApproved called; isMarketApproved/approvedMarketAt populated |
| `setMarketDepositLimit(ovrflo, market, limit)` | vault, market, limit | OVRFLO.marketDepositLimits[market] = limit |
| `sweepExcessPt(ovrflo, ptToken, to)` | vault, PT token, recipient | PT: vault → recipient (excess only) |
| `sweepExcessUnderlying(ovrflo, to)` | vault, recipient | underlying: vault → recipient (excess only) |
| `setFlashFeeBps(ovrflo, feeBps)` | vault, fee bps | OVRFLO.flashFeeBps = feeBps |
| `setFlashLoanPaused(ovrflo, paused)` | vault, bool | OVRFLO.flashLoanPaused = paused |
| `prepareOracle(market, twapDuration)` | market, TWAP duration | Pendle oracle cardinality increased |
| `setBookAprBounds(book, aprMin, aprMax)` | book, min/max APR | OVRFLOBook.aprMinBps/aprMaxBps set |
| `setBookFee(book, feeBps)` | book, fee bps | OVRFLOBook.feeBps = feeBps |
| `setBookTreasury(book, treasury)` | book, treasury address | OVRFLOBook.treasury = treasury |

### OVRFLO (onlyAdmin = factory, forwarded from multisig)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setSeriesApproved(market, pt, twapDuration, expiry, feeBps)` | market config | _series[market] + ptToMarket[pt] set (one-shot) |
| `setMarketDepositLimit(market, limit)` | market, limit | marketDepositLimits[market] = limit |
| `sweepExcessPt(ptToken, to)` | PT token, recipient | PT: vault → recipient (excess only) |
| `sweepExcessUnderlying(to)` | recipient | underlying: vault → recipient (excess only) |
| `setFlashFeeBps(feeBps)` | fee bps | flashFeeBps = feeBps |
| `setFlashLoanPaused(paused)` | bool | flashLoanPaused = paused |

### OVRFLOBook (onlyOwner = factory, forwarded from multisig)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `setAprBounds(aprMinBps, aprMaxBps)` | min/max APR | aprMinBps/aprMaxBps set |
| `setFee(feeBps)` | fee bps | feeBps set |
| `setTreasury(treasury)` | treasury address | treasury set |

### OVRFLOToken (onlyOwner = OVRFLO vault)

| Function | Parameters | State Modified |
|----------|------------|----------------|
| `transferOwnership(newOwner)` | new owner address | owner = newOwner |
| `mint(to, amount)` | recipient, amount | ERC20 totalSupply + balanceOf[to] += amount |
| `burn(from, amount)` | holder, amount | ERC20 totalSupply + balanceOf[from] -= amount |
