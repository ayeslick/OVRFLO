# Entry Point Map

> OVRFLO | 41 entry points | 15 permissionless | 9 role-gated | 17 admin-only

---

## Protocol Flow Paths

### Setup (Timelocked Multisig)

`configureDeployment()` → `deploy()` → `addMarket()`  ◄── Pendle oracle history must be ready and SY underlying must match

`[vault setup above]` → `deployLending()` → `setLendingAprBounds()` / `setLendingFee()` / `setLendingTreasury()`

### Vault User Flow

`[market setup above]` → `deposit()`  ◄── before maturity and below market cap
                              ├─→ `claim()`  ◄── after that PT series matures
                              └─→ `flashLoan()`  ◄── before maturity, oracle ready, not paused

`[vault deployment above]` → `wrap()` → `unwrap()`  ◄── tracked underlying reserve must cover amount

### Stream Seller and Buyer Flow

`[deposit above]` → Sablier stream → `supplyLiquidity()` → `sellStreamToLiquidity()`

`[deposit above]` → Sablier stream → `postSaleListing()`
                                         ├─→ `cancelSaleListing()`
                                         └─→ `buyListing()`

### Borrower and Lender Flow

`[supplyLiquidity above]` → `createBorrowerLoanPool()`  ◄── sorted matching positions and eligible stream
                                  ├─→ `repayLoan()`  ◄── borrower only
                                  ├─→ `closeLoan()`  ◄── accrued stream amount covers outstanding
                                  └─→ `claimLoanPoolShare()`  ◄── caller contributed to pool

---

## Permissionless

### `OVRFLO.wrap(uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Token holder |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ IERC20.safeTransferFrom() → OVRFLOToken.mint()` |
| State modified | `wrappedUnderlying`, token supply and caller balance |
| Value flow | Underlying: caller → vault; ovrfloToken: vault mint → caller |
| Reentrancy guard | no |

### `OVRFLO.deposit(address,uint256,uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | PT depositor |
| Parameters | `market`, `ptAmount`, `minToUser` (user-controlled) |
| Call chain | `→ PendleOracle.getOracleState/getPtToSyRate() → OVRFLOToken.mint() → Sablier.createWithDurations()` |
| State modified | `marketTotalDeposited`, token supply and balances, external stream state |
| Value flow | PT and fee underlying in; ovrfloToken minted to user and stream |
| Reentrancy guard | no |

### `OVRFLOLending.supplyLiquidity(address,uint16,uint128)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Liquidity lender |
| Parameters | `market`, `aprBps`, `availableLiquidity` (user-controlled) |
| Call chain | `→ StreamPricing.marketActive() → IERC20.safeTransferFrom()` |
| State modified | `nextLiquidityId`, `liquidityPositions` |
| Value flow | Underlying: lender → lending market |
| Reentrancy guard | yes |

### `OVRFLOLending.buyListing(uint256,uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Stream buyer |
| Parameters | `listingId`, `maxPriceIn` (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → IERC20.safeTransferFrom/safeTransfer() → Sablier.transferFrom()` |
| State modified | `saleListings[listingId].active`, external token and stream ownership |
| Value flow | Underlying: buyer → seller and treasury; stream NFT: market → buyer |
| Reentrancy guard | yes |

### `OVRFLOLending.createBorrowerLoanPool(uint256[],uint256,uint128,uint128)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Borrower and stream owner |
| Parameters | `liquidityIds`, `streamId`, `targetBorrow`, `minAcceptable` (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible/obligationForFill() → Sablier.transferFrom() → IERC20.safeTransfer()` |
| State modified | ID counters, liquidity positions, pool/loan records, contributions and links |
| Value flow | Underlying: market → borrower and treasury; stream NFT: borrower → market |
| Reentrancy guard | yes |

### `OVRFLO.unwrap(uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20.safeTransfer()` |
| State modified | `wrappedUnderlying`, token supply and caller balance |
| Value flow | ovrfloToken burned; underlying: vault → caller |
| Reentrancy guard | no |

### `OVRFLO.claim(address,uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder |
| Parameters | `ptToken`, `amount` (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20.safeTransfer()` |
| State modified | `marketTotalDeposited`, token supply and caller balance |
| Value flow | ovrfloToken burned; PT: vault → caller |
| Reentrancy guard | no |

### `OVRFLO.flashLoan(address,uint256,bytes)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Flash borrower contract |
| Parameters | `ptToken`, `amount`, `data` (user-controlled) |
| Call chain | `→ PendleOracle.getOracleState/getPtToSyRate() → IERC20.safeTransfer() → borrower.onFlashLoan() → IERC20.safeTransferFrom()` |
| State modified | no persistent protocol storage |
| Value flow | PT out and back; optional underlying fee: borrower → treasury |
| Reentrancy guard | yes |

### `OVRFLOLending.withdrawLiquidity(uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Position lender, enforced in body |
| Parameters | `liquidityId` (user-controlled) |
| Call chain | `→ IERC20.safeTransfer()` |
| State modified | position `availableLiquidity`, `active` |
| Value flow | Underlying: lending market → lender |
| Reentrancy guard | yes |

### `OVRFLOLending.sellStreamToLiquidity(uint256,uint256,uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Eligible stream owner |
| Parameters | `liquidityId`, `streamId`, `minNetOut` (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible/grossPrice() → Sablier.transferFrom() → IERC20.safeTransfer()` |
| State modified | position liquidity and active flag, external stream ownership |
| Value flow | Stream NFT: seller → lender; underlying: market → seller and treasury |
| Reentrancy guard | yes |

### `OVRFLOLending.postSaleListing(address,uint256,uint16)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Eligible stream owner |
| Parameters | `market`, `streamId`, `aprBps` (user-controlled) |
| Call chain | `→ StreamPricing.requireEligible() → Sablier.transferFrom()` |
| State modified | `nextSaleListingId`, `saleListings`, external stream ownership |
| Value flow | Stream NFT: seller → lending market |
| Reentrancy guard | yes |

### `OVRFLOLending.cancelSaleListing(uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Listing seller, enforced in body |
| Parameters | `listingId` (user-controlled) |
| Call chain | `→ Sablier.transferFrom()` |
| State modified | listing `active`, external stream ownership |
| Value flow | Stream NFT: lending market → seller |
| Reentrancy guard | yes |

### `OVRFLOLending.closeLoan(uint256)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Any account |
| Parameters | `loanId` (user-controlled) |
| Call chain | `→ Sablier.withdrawableAmountOf/withdraw/transferFrom()` |
| State modified | loan `closed`, `drawn`, pool proceeds, external stream ownership |
| Value flow | ovrfloToken: stream → market; stream NFT: market → borrower |
| Reentrancy guard | yes |

### `OVRFLOLending.repayLoan(uint256,uint128)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Loan borrower, enforced in body |
| Parameters | `loanId`, `amount` (user-controlled) |
| Call chain | `→ IERC20.safeTransferFrom() → Sablier.transferFrom()` when fully repaid |
| State modified | loan `repaid`, `closed`, pool proceeds, external stream ownership |
| Value flow | ovrfloToken: borrower → market; optional stream NFT: market → borrower |
| Reentrancy guard | yes |

### `OVRFLOLending.claimLoanPoolShare(uint256,uint128)`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Pool contributor, enforced in `_claimFair` |
| Parameters | `loanPoolId`, `amount` (user-controlled) |
| Call chain | `→ Sablier.withdrawableAmountOf/withdraw() → IERC20.safeTransfer()` |
| State modified | loan `drawn`, pool proceeds and caller receipt accounting |
| Value flow | ovrfloToken: stream/market → lender |
| Reentrancy guard | yes |

---

## Role-Gated

### Immutable factory (`OVRFLO.onlyAdmin`)

| Contract | Function | Parameters | State Modified / Value Flow |
|----------|----------|------------|-----------------------------|
| OVRFLO | `setSeriesApproved` | market, PT, TWAP, expiry, fee | one-shot series and PT mapping |
| OVRFLO | `setMarketDepositLimit` | market, limit | market cap |
| OVRFLO | `sweepExcessPt` | PT, recipient | excess PT out |
| OVRFLO | `sweepExcessUnderlying` | recipient | excess underlying out |
| OVRFLO | `setFlashFeeBps` | fee | flash fee |
| OVRFLO | `setFlashLoanPaused` | paused | flash circuit breaker |

### Vault owner (`OVRFLOToken.onlyOwner`)

| Contract | Function | Parameters | State Modified / Value Flow |
|----------|----------|------------|-----------------------------|
| OVRFLOToken | `transferOwnership` | new owner | token owner, one-step transfer |
| OVRFLOToken | `mint` | recipient, amount | supply and recipient balance increase |
| OVRFLOToken | `burn` | holder, amount | supply and holder balance decrease |

---

## Admin-Only

All entries below are `onlyOwner`. The intended owner is the timelocked multisig for OVRFLOFactory, while each factory-deployed OVRFLOLending is owned by the factory.

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOFactory | `configureDeployment` | treasury, underlying, name/symbol suffix | staged deployment config |
| OVRFLOFactory | `cancelDeployment` | none | clears staged config |
| OVRFLOFactory | `deploy` | none | deploys/registers vault and token |
| OVRFLOFactory | `deployLending` | vault | deploys/registers lending market |
| OVRFLOFactory | `addMarket` | vault, market, TWAP, fee | both market registries and vault series |
| OVRFLOFactory | `setMarketDepositLimit` | vault, market, limit | forwards vault cap |
| OVRFLOFactory | `sweepExcessPt` | vault, PT, recipient | forwards PT recovery |
| OVRFLOFactory | `sweepExcessUnderlying` | vault, recipient | forwards underlying recovery |
| OVRFLOFactory | `setFlashFeeBps` | vault, fee | forwards flash fee |
| OVRFLOFactory | `setFlashLoanPaused` | vault, paused | forwards flash pause |
| OVRFLOFactory | `prepareOracle` | market, TWAP | external Pendle observation cardinality |
| OVRFLOFactory | `setLendingAprBounds` | lending, min/max APR | forwards lending APR bounds |
| OVRFLOFactory | `setLendingFee` | lending, fee | forwards lending fee |
| OVRFLOFactory | `setLendingTreasury` | lending, treasury | forwards lending fee recipient |
| OVRFLOLending | `setAprBounds` | min/max APR | APR bounds |
| OVRFLOLending | `setFee` | fee | global fill fee |
| OVRFLOLending | `setTreasury` | treasury | fee recipient |
