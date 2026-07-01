# OVRFLO Fuzz Property Plan

Implementation-facing artifact. Derived from 5 invariant discovery agents, deduplicated, feasibility-checked, and classified.

---

## 1. Global Properties (checked after every handler call)

Public functions with `property_` prefix in Properties.sol. Called by fuzzer after each handler invocation.

| Spec ID | Property | Category | Guarantee | Evidence | Priority |
|---------|----------|----------|-----------|----------|----------|
| GL-01 | totalSupply == marketTotalDeposited + wrappedUnderlying | HIGH_LEVEL | SHOULD-HOLD | I-1 delta-pair: deposit +ptAmount both, claim -amount both, wrap +amount both, unwrap -amount both | HIGH |
| GL-02 | wrappedUnderlying <= underlying.balanceOf(vault) | VALID_STATE | SHOULD-HOLD | I-7: wrap/unwrap delta pairs, sweep only takes excess | HIGH |
| GL-03 | marketTotalDeposited <= ptToken.balanceOf(vault) at rest | VALID_STATE | SHOULD-HOLD | I-8: deposit/claim delta pairs, flashLoan atomic, sweep only takes excess | HIGH |
| GL-04 | sum(poolProceeds) <= ovrfloToken.balanceOf(book) | HIGH_LEVEL | SHOULD-HOLD | Pattern B: internal accounting <= external reality | HIGH |
| GL-05 | sum(offer.capacity) <= underlying.balanceOf(book) | HIGH_LEVEL | SHOULD-HOLD | Pattern B: offer capacity backed by underlying | HIGH |
| GL-06 | sum(poolProceeds) == ovrfloToken.balanceOf(book) strict | HIGH_LEVEL | EXPLORATORY | True if no direct transfers to book | MEDIUM |
| GL-07 | sum(offer.capacity) == underlying.balanceOf(book) strict | HIGH_LEVEL | EXPLORATORY | True if no direct transfers to book | HIGH |
| GL-08 | drawn + repaid <= obligation for every loan | VALID_STATE | SHOULD-HOLD | All increments capped at outstanding | HIGH |
| GL-09 | poolProceeds <= totalObligation for every pool | VALID_STATE | SHOULD-HOLD | Derived from GL-08 + SP-25 conservation | MEDIUM |
| GL-10 | loan.obligation == pool.totalObligation for pool loans | VALID_STATE | SHOULD-HOLD | Both set from same variable at creation, never modified | MEDIUM |
| GL-11 | offer.active never goes false -> true | STATE_TRANSITION | SHOULD-HOLD | Only set false in cancel/sell, never reset | HIGH |
| GL-12 | saleListing.active never goes false -> true | STATE_TRANSITION | SHOULD-HOLD | Only set false in cancel/buy, never reset | HIGH |
| GL-13 | loan.closed never goes true -> false | STATE_TRANSITION | SHOULD-HOLD | Only set true in close/repay, never reset | HIGH |
| GL-14 | pool.active always true for existing pools | VALID_STATE | EXPLORATORY | No code path sets pool.active = false | MEDIUM |
| GL-15 | All 4 ID counters monotonically non-decreasing | VARIABLE_TRANSITION | SHOULD-HOLD | Only ++ operations, never decremented | HIGH |
| GL-16 | loan.drawn never decreases for any loan | VARIABLE_TRANSITION | SHOULD-HOLD | Only += in closeLoan/poolClaimLoan | HIGH |
| GL-17 | loan.repaid never decreases for any loan | VARIABLE_TRANSITION | SHOULD-HOLD | Only += in repayLoan | HIGH |
| GL-18 | poolReceived[poolId][contributor] never decreases | VARIABLE_TRANSITION | SHOULD-HOLD | Only += in poolClaimLoan/claimPoolShare | HIGH |
| GL-19 | factory.ovrfloCount never decreases | VARIABLE_TRANSITION | SHOULD-HOLD | Only ++ in deploy | LOW |
| GL-20 | factory.bookCount never decreases | VARIABLE_TRANSITION | SHOULD-HOLD | Only ++ in deployBook | LOW |
| GL-21 | factory.approvedMarketCount never decreases | VARIABLE_TRANSITION | SHOULD-HOLD | Only ++ in addMarket | LOW |
| GL-22 | pool exists iff poolLoanId[poolId] != 0 | VALID_STATE | SHOULD-HOLD | I-18: set together in createBorrowPool | HIGH |
| GL-23 | loan exists iff loanPoolId[loanId] != 0 | VALID_STATE | SHOULD-HOLD | Set together in _storeLoan + createBorrowPool | HIGH |
| GL-24 | poolLoanId[poolId]==loanId iff loanPoolId[loanId]==poolId | VALID_STATE | SHOULD-HOLD | Set as a pair in createBorrowPool | HIGH |
| GL-25 | offer slot populated iff id < nextOfferId | VALID_STATE | SHOULD-HOLD | nextOfferId only increments, slots never cleared | HIGH |
| GL-26 | loan slot populated iff id < nextLoanId | VALID_STATE | SHOULD-HOLD | nextLoanId only increments | HIGH |
| GL-27 | pool slot populated iff id < nextPoolId | VALID_STATE | SHOULD-HOLD | nextPoolId only increments | HIGH |
| GL-28 | listing slot populated iff id < nextSaleListingId | VALID_STATE | SHOULD-HOLD | nextSaleListingId only increments | HIGH |
| GL-29 | underlyingToOvrflo one-shot | VALID_STATE | SHOULD-HOLD | I-10: guarded in configureDeployment | LOW |
| GL-30 | ovrfloToBook iff bookToOvrflo | VALID_STATE | SHOULD-HOLD | Set as a pair in deployBook | LOW |
| GL-31 | loan.closed implies drawn+repaid==obligation | VALID_STATE | SHOULD-HOLD | closed set only when outstanding==0 | HIGH |
| GL-32 | offer.active iff capacity > 0 | VALID_STATE | SHOULD-HOLD | active and capacity managed together | HIGH |
| GL-33 | loan.obligation immutable after creation | VARIABLE_TRANSITION | EXPLORATORY | No write path after _storeLoan | HIGH |
| GL-34 | loan.streamId immutable | VARIABLE_TRANSITION | EXPLORATORY | No write path after _storeLoan | HIGH |
| GL-35 | loan.borrower/lender immutable | VARIABLE_TRANSITION | EXPLORATORY | No write path after _storeLoan | HIGH |
| GL-36 | offer.maker/aprBps immutable | VARIABLE_TRANSITION | EXPLORATORY | No write path after postOffer | MEDIUM |
| GL-37 | listing.feeBps immutable (snapshot) | VARIABLE_TRANSITION | EXPLORATORY | No write path after postSaleListing | MEDIUM |
| GL-38 | pool.totalContributed immutable | VARIABLE_TRANSITION | EXPLORATORY | No write path after createBorrowPool | HIGH |
| GL-39 | pool.totalObligation immutable | VARIABLE_TRANSITION | EXPLORATORY | No write path after createBorrowPool | HIGH |
| GL-40 | poolContributions immutable after creation | VARIABLE_TRANSITION | EXPLORATORY | Only written in _consumeOffers during createBorrowPool | HIGH |
| GL-41 | series ptToken/expiryCached/feeBps immutable | VARIABLE_TRANSITION | SHOULD-HOLD | I-9: setSeriesApproved one-shot guard | HIGH |
| GL-42 | ptToMarket immutable | VARIABLE_TRANSITION | SHOULD-HOLD | setSeriesApproved one-shot guard | HIGH |
| GL-43 | grossPrice always floors | VALID_STATE | SHOULD-HOLD | PRBMath.mulDiv floors, NatSpec | HIGH |
| GL-44 | obligation always ceils | VALID_STATE | SHOULD-HOLD | Explicit +1 on remainder, NatSpec | HIGH |
| GL-45 | factor >= WAD always | VALID_STATE | SHOULD-HOLD | WAD + non-negative term, NatSpec | LOW |
| GL-46 | wrap(0) reverts | VALID_STATE | SHOULD-HOLD | require amount > 0 | LOW |
| GL-47 | unwrap(0) reverts | VALID_STATE | SHOULD-HOLD | require amount > 0 | LOW |
| GL-48 | deposit below MIN_PT_AMOUNT reverts | VALID_STATE | SHOULD-HOLD | require >= MIN_PT_AMOUNT | LOW |
| GL-49 | claim(0) reverts | VALID_STATE | SHOULD-HOLD | require amount > 0 | LOW |
| GL-50 | postOffer(0) reverts | VALID_STATE | SHOULD-HOLD | require capacity > 0 | LOW |
| GL-51 | toUser monotonic non-decreasing in ptAmount | VARIABLE_TRANSITION | SHOULD-HOLD | mulDiv monotonic | LOW |
| GL-52 | grossPrice monotonic non-decreasing in remaining | VARIABLE_TRANSITION | SHOULD-HOLD | mulDiv monotonic | LOW |
| GL-53 | obligation monotonic non-decreasing in borrowAmount | VARIABLE_TRANSITION | SHOULD-HOLD | ceil monotonic | LOW |
| GL-54 | grossPrice non-increasing in timeToMaturity | VARIABLE_TRANSITION | SHOULD-HOLD | factor increases with ttm | LOW |
| GL-55 | Pure wrapper can always unwrap | HIGH_LEVEL | EXPLORATORY | wrap/unwrap is independent of deposit/claim | HIGH |
| GL-56 | Depositor can always claim PT | HIGH_LEVEL | EXPLORATORY | MTD tracks deposits, wrap doesn't affect it | HIGH |
| GL-57 | No free profit: actor value <= start + yield | HIGH_LEVEL | EXPLORATORY | All operations are fair-value priced | HIGH |
| GL-58 | After all withdraw: supply==0, MTD==0, wrapped==0 | VALID_STATE | SHOULD-HOLD | All tokens burnable, accounting returns to zero | MEDIUM |
| GL-59 | No orphaned wrap reserve | HIGH_LEVEL | EXPLORATORY | wrappedUnderlying only changes on wrap/unwrap | HIGH |
| GL-60 | totalSupply == sum of all known holder balances | HIGH_LEVEL | SHOULD-HOLD | ERC-20 standard | HIGH |
| GL-61 | Self-transfer doesn't change balance/supply | VALID_STATE | SHOULD-HOLD | ERC-20 standard | MEDIUM |
| GL-62 | Zero-amount transfer doesn't change state | VALID_STATE | SHOULD-HOLD | ERC-20 standard | MEDIUM |
| GL-63 | Sum outstanding <= sum remaining face values | HIGH_LEVEL | EXPLORATORY | obligation <= remaining per loan | LOW |

---

## 2. Specific Properties (checked at end of relevant handler)

Internal functions called at the end of the handler that triggers them.

| Spec ID | Property | Category | Guarantee | Evidence | Priority | Called After |
|---------|----------|----------|-----------|----------|----------|--------------|
| SP-01 | wrap -> unwrap returns exactly same underlying | HIGH_LEVEL | SHOULD-HOLD | 1:1 no mulDiv | HIGH | roundTrip_wrapUnwrap |
| SP-02 | unwrap -> wrap returns exactly same ovrfloToken | HIGH_LEVEL | SHOULD-HOLD | 1:1 no mulDiv | HIGH | roundTrip_unwrapWrap |
| SP-03 | postOffer -> cancelOffer returns same capacity | HIGH_LEVEL | SHOULD-HOLD | _pullExact + _payUnderlying exact | HIGH | roundTrip_postOfferCancel, cancelOffer |
| SP-04 | postSaleListing -> cancelSaleListing returns stream unchanged | HIGH_LEVEL | SHOULD-HOLD | transferFrom reversible | MEDIUM | roundTrip_postListingCancel, cancelSaleListing |
| SP-05 | deposit -> claim conserves value (PT recovered, fee only loss) | HIGH_LEVEL | SHOULD-HOLD | toUser+toStream=ptAmount, claim 1:1 | HIGH | roundTrip_depositClaim |
| SP-06 | N cycles wrap -> unwrap do not increase balance (C2 dust) | HIGH_LEVEL | SHOULD-HOLD | Exact 1:1, no rounding | HIGH | roundTrip_wrapUnwrap |
| SP-07 | deposit conserves toUser+toStream=ptAmount, toStream>0 | VALID_STATE | SHOULD-HOLD | Exact subtraction, not second mulDiv | HIGH | deposit |
| SP-08 | flash loan atomically repaid, vault never loses PT | VALID_STATE | SHOULD-HOLD | nonReentrant, exact return + fee | HIGH | flashLoan |
| SP-09 | borrow -> repay: obligation >= actualBorrow | VALID_STATE | SHOULD-HOLD | factor >= WAD, obligation ceils | HIGH | createBorrowPool |
| SP-10 | obligation <= remaining in partial-borrow path | VALID_STATE | SHOULD-HOLD | Mathematical proof, NatSpec | HIGH | createBorrowPool |
| SP-11 | previewDeposit matches actual deposit | VALID_STATE | SHOULD-HOLD | Same code path, fixed mock rate | MEDIUM | deposit |
| SP-12 | previewStream matches actual deposit split | VALID_STATE | SHOULD-HOLD | Same code path | MEDIUM | deposit |
| SP-13 | quote matches actual createBorrowPool obligation | VALID_STATE | SHOULD-HOLD | Same pricing path | MEDIUM | createBorrowPool |
| SP-14 | deposit floors toUser; claim exact 1:1 | VALID_STATE | SHOULD-HOLD | toStream=ptAmount-toUser captures dust | MEDIUM | deposit, claim |
| SP-15 | full-borrow fast-path returns remaining exactly | VALID_STATE | SHOULD-HOLD | obligationForFill code, NatSpec | HIGH | createBorrowPool |
| SP-16 | deposit toUser capped at ptAmount | VALID_STATE | SHOULD-HOLD | Cap + toStream>0 guard | MEDIUM | deposit |
| SP-17 | deposit fee floored | VALID_STATE | SHOULD-HOLD | PRBMath.mulDiv floors | MEDIUM | deposit |
| SP-18 | flash loan fee double-floored | VALID_STATE | SHOULD-HOLD | Two nested mulDiv | MEDIUM | flashLoan |
| SP-19 | book fee floored (StreamPricing.fee) | VALID_STATE | SHOULD-HOLD | mulDiv floors | MEDIUM | sellIntoOffer, buyListing, createBorrowPool |
| SP-20 | pro-rata entitlement floored | VALID_STATE | EXPLORATORY | Solidity integer division | MEDIUM | poolClaimLoan, claimPoolShare |
| SP-21 | repayLoan equality check exact (no rounding brick) | VALID_STATE | SHOULD-HOLD | Exact integer, NatSpec | MEDIUM | repayLoan |
| SP-22 | sum(poolContributions) == totalContributed | VALID_STATE | SHOULD-HOLD | _consumeOffers sums to actualBorrow | HIGH | createBorrowPool |
| SP-23 | sum(poolReceived) <= totalObligation | VALID_STATE | SHOULD-HOLD | Each poolReceived <= entitlement, sum <= obligation | HIGH | poolClaimLoan, claimPoolShare |
| SP-24 | poolReceived[i] <= entitlement (pro-rata cap) | VALID_STATE | SHOULD-HOLD | E-3: enforced in both claim channels | HIGH | poolClaimLoan, claimPoolShare |
| SP-25 | poolProceeds + sum(poolReceived) == drawn + repaid | HIGH_LEVEL | SHOULD-HOLD | Delta-pair conservation | HIGH | closeLoan, repayLoan, poolClaimLoan, claimPoolShare |
| SP-26 | marketTotalDeposited increases by ptAmount | STATE_TRANSITION | SHOULD-HOLD | Explicit assignment | HIGH | deposit |
| SP-27 | wrappedUnderlying unchanged after deposit | STATE_TRANSITION | EXPLORATORY | No write path in deposit | MEDIUM | deposit |
| SP-28 | deposit only succeeds pre-maturity | STATE_TRANSITION | SHOULD-HOLD | require block.timestamp < expiry | HIGH | deposit |
| SP-29 | marketTotalDeposited decreases by amount | STATE_TRANSITION | SHOULD-HOLD | Explicit assignment | HIGH | claim |
| SP-30 | claim only succeeds post-maturity | STATE_TRANSITION | SHOULD-HOLD | require block.timestamp >= expiry | HIGH | claim |
| SP-31 | wrappedUnderlying unchanged after claim | STATE_TRANSITION | EXPLORATORY | No write path in claim | MEDIUM | claim |
| SP-32 | wrappedUnderlying increases by amount | STATE_TRANSITION | SHOULD-HOLD | Explicit += in wrap | HIGH | wrap |
| SP-33 | wrappedUnderlying decreases by amount | STATE_TRANSITION | SHOULD-HOLD | Explicit -= in unwrap | HIGH | unwrap |
| SP-34 | marketTotalDeposited unchanged after wrap | STATE_TRANSITION | EXPLORATORY | No write path in wrap | MEDIUM | wrap |
| SP-35 | marketTotalDeposited unchanged after unwrap | STATE_TRANSITION | EXPLORATORY | No write path in unwrap | MEDIUM | unwrap |
| SP-36 | flashLoan: marketTotalDeposited unchanged | STATE_TRANSITION | SHOULD-HOLD | No write path in flashLoan | HIGH | flashLoan |
| SP-37 | flash loan only succeeds pre-maturity | STATE_TRANSITION | SHOULD-HOLD | require block.timestamp < expiry | HIGH | flashLoan |
| SP-38 | flashLoan: wrappedUnderlying unchanged | STATE_TRANSITION | EXPLORATORY | No write path in flashLoan | MEDIUM | flashLoan |
| SP-39 | sweepExcessPt: marketTotalDeposited unchanged | STATE_TRANSITION | EXPLORATORY | No write path in sweep | MEDIUM | sweepExcessPt |
| SP-40 | sweepExcessUnderlying: wrappedUnderlying unchanged | STATE_TRANSITION | EXPLORATORY | No write path in sweep | MEDIUM | sweepExcessUnderlying |
| SP-41 | setFlashFeeBps: flashFeeBps == arg, <= max | STATE_TRANSITION | SHOULD-HOLD | Explicit assignment + require | LOW | setFlashFeeBps |
| SP-42 | setFlashLoanPaused: flashLoanPaused == arg | STATE_TRANSITION | SHOULD-HOLD | Explicit assignment | LOW | setFlashLoanPaused |
| SP-43 | postOffer: nextOfferId increments by 1 | STATE_TRANSITION | SHOULD-HOLD | nextOfferId++ | HIGH | postOffer |
| SP-44 | postOffer: new offer active, capacity > 0, maker == sender | STATE_TRANSITION | SHOULD-HOLD | Explicit struct assignment | HIGH | postOffer |
| SP-45 | cancelOffer: offer inactive, capacity == 0 | STATE_TRANSITION | SHOULD-HOLD | Explicit assignment | HIGH | cancelOffer |
| SP-46 | sellIntoOffer: capacity -= grossPrice, active=false only if capacity==0 | STATE_TRANSITION | SHOULD-HOLD | Explicit decrement + conditional | HIGH | sellIntoOffer |
| SP-47 | postSaleListing: nextSaleListingId increments by 1 | STATE_TRANSITION | SHOULD-HOLD | nextSaleListingId++ | HIGH | postSaleListing |
| SP-48 | postSaleListing: listing active, feeBps snapshotted | STATE_TRANSITION | SHOULD-HOLD | Explicit struct assignment | MEDIUM | postSaleListing |
| SP-49 | cancelSaleListing: listing inactive | STATE_TRANSITION | SHOULD-HOLD | listing.active = false | HIGH | cancelSaleListing |
| SP-50 | buyListing: listing inactive | STATE_TRANSITION | SHOULD-HOLD | listing.active = false | HIGH | buyListing |
| SP-51 | createBorrowPool: nextPoolId and nextLoanId each +1 | STATE_TRANSITION | SHOULD-HOLD | Both ++ in createBorrowPool | HIGH | createBorrowPool |
| SP-52 | createBorrowPool: pool active, loan closed=false, drawn=0, repaid=0 | STATE_TRANSITION | SHOULD-HOLD | Explicit struct assignment | HIGH | createBorrowPool |
| SP-53 | createBorrowPool: poolContributions set for consumed makers | STATE_TRANSITION | SHOULD-HOLD | _consumeOffers sets contributions | HIGH | createBorrowPool |
| SP-54 | closeLoan: drawn += outstanding, poolProceeds += outstanding (if >0) | STATE_TRANSITION | SHOULD-HOLD | Explicit += in closeLoan | HIGH | closeLoan |
| SP-55 | closeLoan outstanding==0: drawn and poolProceeds unchanged | STATE_TRANSITION | SHOULD-HOLD | if (outstanding > 0) guard | MEDIUM | closeLoan |
| SP-56 | repayLoan: repaid += amount, poolProceeds += amount | STATE_TRANSITION | SHOULD-HOLD | Explicit += in repayLoan | HIGH | repayLoan |
| SP-57 | repayLoan: closed=true iff amount==outstanding; partial stays false | STATE_TRANSITION | SHOULD-HOLD | bool closes = amount == outstanding | HIGH | repayLoan |
| SP-58 | poolClaimLoan: drawn += drawAmount, poolReceived += drawAmount | STATE_TRANSITION | SHOULD-HOLD | Explicit += in poolClaimLoan | HIGH | poolClaimLoan |
| SP-59 | poolClaimLoan: poolProceeds unchanged | STATE_TRANSITION | EXPLORATORY | No write to poolProceeds | MEDIUM | poolClaimLoan |
| SP-60 | claimPoolShare: poolReceived += amount, poolProceeds -= amount | STATE_TRANSITION | SHOULD-HOLD | Explicit += and -= | HIGH | claimPoolShare |
| SP-61 | paired deposit -> claim: MTD returns to pre-deposit | STATE_TRANSITION | EXPLORATORY | deposit +ptAmount, claim -amount | MEDIUM | roundTrip_depositClaim |
| SP-62 | deposit liveness: valid preconditions -> must succeed | VALID_STATE | SHOULD-HOLD | All require guards checked | HIGH | deposit |
| SP-63 | No share inflation: toUser/ptAmount non-decreasing | VALID_STATE | SHOULD-HOLD | Fixed mock rate, not share-based | MEDIUM | deposit |
| SP-64 | flash loan borrower net value <= before | VALID_STATE | SHOULD-HOLD | Fee charged, no free PT | HIGH | flashLoan |
| SP-65 | Dust ovrfloToken position has exit path | VALID_STATE | EXPLORATORY | unwrap/claim work for small amounts | MEDIUM | wrap, deposit |
| SP-66 | Dust contributor not bricked by truncation | VALID_STATE | EXPLORATORY | Entitlement > 0 when contribution > 0 | MEDIUM | createBorrowPool, claimPoolShare |
| SP-67 | No uint128 overflow in pool accounting | VALID_STATE | SHOULD-HOLD | _toUint128 reverts on overflow | MEDIUM | createBorrowPool |
| SP-68 | Full-amount operations safe (entire balance in one call) | VALID_STATE | SHOULD-HOLD | Clamped handlers allow full balance | MEDIUM | all clamped handlers |
| SP-69 | Non-admin cannot call vault admin functions | VALID_STATE | SHOULD-HOLD | onlyAdmin modifier | HIGH | vault admin handlers |
| SP-70 | Non-owner cannot call book admin functions | VALID_STATE | SHOULD-HOLD | onlyOwner modifier | HIGH | book admin handlers |
| SP-71 | Non-maker cannot cancel offer or listing | VALID_STATE | SHOULD-HOLD | maker == msg.sender check | HIGH | cancelOffer, cancelSaleListing |
| SP-72 | Non-borrower cannot repayLoan | VALID_STATE | SHOULD-HOLD | borrower == msg.sender check | HIGH | repayLoan |
| SP-73 | Stream owner only (no stream theft) | VALID_STATE | SHOULD-HOLD | sablier.transferFrom from msg.sender | HIGH | sellIntoOffer, postSaleListing, createBorrowPool |
| SP-74 | closeLoan no grief: poolProceeds sufficient for lender | VALID_STATE | EXPLORATORY | Lender can claim after close | MEDIUM | closeLoan |
| SP-75 | Offer consumed correctly: sale or loan, value to maker | VALID_STATE | EXPLORATORY | Capacity decremented, stream/value transferred | MEDIUM | sellIntoOffer, createBorrowPool |
| SP-76 | Low deposit limit does not brick claims | VALID_STATE | SHOULD-HOLD | Claim uses MTD not deposit limit | MEDIUM | claim |
| SP-77 | No self-match bypass | VALID_STATE | SHOULD-HOLD | offer.maker != borrower check | HIGH | createBorrowPool |
| SP-78 | No loan on zero-remaining stream | VALID_STATE | SHOULD-HOLD | requireEligible reverts on RemainingZero | MEDIUM | createBorrowPool |
| SP-79 | borrowAmount <= grossPrice (LTV check) | VALID_STATE | SHOULD-HOLD | require actualBorrow <= grossPrice | HIGH | createBorrowPool |
| SP-80 | Offer IDs strictly increasing, sorted input | VALID_STATE | SHOULD-HOLD | Pattern #11: require offerIds[i] > offerIds[i-1] | MEDIUM | createBorrowPool |

---

## 3. Ghost Variables (Base.sol Ghosts struct + mappings)

### Ghosts Struct Fields

| # | Name | Type | Purpose | Updated By |
|---|------|------|---------|------------|
| 1 | ghost_lastNextOfferId | uint256 | GL-15 ID monotonicity | every handler (global check) |
| 2 | ghost_lastNextSaleListingId | uint256 | GL-15 ID monotonicity | every handler |
| 3 | ghost_lastNextLoanId | uint256 | GL-15 ID monotonicity | every handler |
| 4 | ghost_lastNextPoolId | uint256 | GL-15 ID monotonicity | every handler |
| 5 | ghost_totalDepositFees | uint256 | SP-17 cumulative fee tracking | deposit |
| 6 | ghost_totalFlashFees | uint256 | SP-18 cumulative fee tracking | flashLoan |
| 7 | ghost_totalBookFees | uint256 | SP-19 cumulative fee tracking | sellIntoOffer, buyListing, createBorrowPool |
| 8 | ghost_lastToUser | uint256 | SP-07, GL-51, SP-63 deposit tracking | deposit |
| 9 | ghost_lastDepositPtAmount | uint256 | GL-51 monotonicity | deposit |
| 10 | ghost_lastGrossPrice | uint256 | GL-52, GL-54 monotonicity | sellIntoOffer, buyListing, createBorrowPool |
| 11 | ghost_lastGrossPriceRemaining | uint128 | GL-52 monotonicity | sellIntoOffer, buyListing, createBorrowPool |
| 12 | ghost_lastGrossPriceTtm | uint256 | GL-54 monotonicity | sellIntoOffer, buyListing, createBorrowPool |
| 13 | ghost_lastObligation | uint128 | GL-53 monotonicity | createBorrowPool |
| 14 | ghost_lastObligationBorrowAmount | uint256 | GL-53 monotonicity | createBorrowPool |
| 15 | ghost_lastPoolId | uint256 | SP-* pool-specific checks | createBorrowPool |
| 16 | ghost_lastLoanId | uint256 | SP-* loan-specific checks | createBorrowPool, closeLoan, repayLoan |
| 17 | ghost_lastOfferId | uint256 | SP-* offer-specific checks | postOffer |
| 18 | ghost_lastListingId | uint256 | SP-* listing-specific checks | postSaleListing |
| 19 | ghost_offerFundedCapacity | uint128 | SP-03 round-trip | postOffer |
| 20 | ghost_depositFeePaid | uint256 | SP-17 fee floored | deposit |
| 21 | ghost_flashFeePaid | uint256 | SP-18 fee floored | flashLoan |
| 22 | ghost_bookFeePaid | uint256 | SP-19 fee floored | sellIntoOffer, buyListing, createBorrowPool |
| 23 | ghost_borrowReceived | uint128 | SP-09 obligation >= borrow | createBorrowPool |
| 24 | ghost_repayPaid | uint128 | SP-56 repay tracking | repayLoan |
| 25 | ghost_streamRemainingBeforeBorrow | uint128 | SP-10 obligation <= remaining | createBorrowPool |
| 26 | ghost_poolEntitlementSum | uint256 | SP-20 pro-rata floored | poolClaimLoan, claimPoolShare |

### Mapping Ghosts (separate storage variables)

| # | Name | Type | Purpose | Updated By |
|---|------|------|---------|------------|
| 27 | ghost_hasDeposited | mapping(address => bool) | GL-55, GL-56 liveness | deposit |
| 28 | ghost_hasWrapped | mapping(address => bool) | GL-55 pure wrapper | wrap |
| 29 | ghost_actorStartValue | mapping(address => uint256) | GL-57 no free profit | setupActors (init only) |

**Total: 29 ghost variables (26 struct fields + 3 mappings)**

---

## 4. Snapshot State (Snapshots.sol State struct)

| # | Field | Type | Captures | Used By |
|---|-------|------|----------|---------|
| 1 | actorUnderlying | uint256 | actor's underlying balance | RT-01..06, SP-01..06, SP-09, SP-17..19, SP-64 |
| 2 | actorOvrfloToken | uint256 | actor's ovrfloToken balance | RT-01..06, SP-01..02, SP-05..07, SP-63..65 |
| 3 | actorPt | uint256 | actor's PT balance | RT-05, SP-05, SP-08, SP-14 |
| 4 | vaultTotalDeposited | uint256 | marketTotalDeposited[market] | SP-26..29, SP-36, SP-39, SP-61 |
| 5 | vaultWrappedUnderlying | uint256 | wrappedUnderlying | SP-27, SP-31..33, SP-38, SP-40 |
| 6 | vaultPtBalance | uint256 | ptToken.balanceOf(vault) | SP-08, SP-18 |
| 7 | ovrfloTotalSupply | uint256 | ovrfloToken.totalSupply() | GL-01, GL-58, GL-60..62 |
| 8 | bookUnderlyingBalance | uint256 | underlying.balanceOf(book) | GL-05, GL-07 |
| 9 | bookOvrfloTokenBalance | uint256 | ovrfloToken.balanceOf(book) | GL-04, GL-06 |
| 10 | poolProceeds | uint256 | poolProceeds[poolId] | SP-25, SP-54..56, SP-59..60 |
| 11 | poolTotalObligation | uint128 | pools[poolId].totalObligation | SP-13, SP-22..24, GL-09 |
| 12 | poolTotalContributed | uint128 | pools[poolId].totalContributed | SP-22, SP-24 |
| 13 | loanObligation | uint128 | loans[loanId].obligation | SP-21, GL-10, GL-33 |
| 14 | loanDrawn | uint128 | loans[loanId].drawn | SP-54, SP-58, GL-16 |
| 15 | loanRepaid | uint128 | loans[loanId].repaid | SP-56, GL-17 |
| 16 | loanClosed | bool | loans[loanId].closed | SP-52, SP-57, GL-13, GL-31 |
| 17 | streamRemaining | uint128 | deposited - withdrawn | SP-04, SP-10, GL-63 |
| 18 | streamOwner | address | sablier.ownerOf(streamId) | SP-04, SP-73 |
| 19 | offerCapacity | uint128 | offers[offerId].capacity | SP-03, SP-45..46, GL-32 |
| 20 | offerActive | bool | offers[offerId].active | SP-44..45, GL-11 |
| 21 | listingActive | bool | saleListings[listingId].active | SP-48..50, GL-12 |
| 22 | nextOfferId | uint256 | book.nextOfferId() | SP-43, GL-15 |
| 23 | nextSaleListingId | uint256 | book.nextSaleListingId() | SP-47, GL-15 |
| 24 | nextLoanId | uint256 | book.nextLoanId() | SP-51, GL-15 |
| 25 | nextPoolId | uint256 | book.nextPoolId() | SP-51, GL-15 |
| 26 | flashFeeBps | uint16 | vault.flashFeeBps() | SP-41 |
| 27 | flashLoanPaused | bool | vault.flashLoanPaused() | SP-42 |
| 28 | poolReceived | uint128 | poolReceived[poolId][actor] | SP-24, SP-58, SP-60, GL-18 |

**Total: 28 snapshot fields**

---

## 5. Handler Wiring

### 5.1 Existing Handlers (snapshot + ghost + assertion wiring)

| Handler | Snapshot | Ghost Updates | Specific Properties |
|---------|----------|---------------|---------------------|
| oVRFLO_deposit_clamped | Before/After | ghost_lastToUser, ghost_lastDepositPtAmount, ghost_depositFeePaid, ghost_totalDepositFees, ghost_hasDeposited, ghost_actorStartValue (on first) | SP-07, SP-11, SP-12, SP-14, SP-16, SP-17, SP-26, SP-27, SP-28, SP-62, SP-63 |
| oVRFLO_claim_clamped | Before/After | none | SP-29, SP-30, SP-31, SP-76 |
| oVRFLO_wrap_clamped | Before/After | ghost_hasWrapped | SP-32, SP-34 |
| oVRFLO_unwrap_clamped | Before/After | none | SP-33, SP-35 |
| oVRFLO_flashLoan_clamped | Before/After | ghost_flashFeePaid, ghost_totalFlashFees | SP-08, SP-18, SP-36, SP-37, SP-38, SP-64 |
| oVRFLO_secondary | Before/After | none | SP-39, SP-40, SP-41, SP-42, SP-69 |
| oVRFLOBook_postOffer_clamped | Before/After | ghost_lastOfferId, ghost_offerFundedCapacity | SP-43, SP-44 |
| oVRFLOBook_sellIntoOffer_clamped | Before/After | ghost_lastGrossPrice, ghost_lastGrossPriceRemaining, ghost_lastGrossPriceTtm, ghost_bookFeePaid, ghost_totalBookFees | SP-19, SP-46, SP-75 |
| oVRFLOBook_postSaleListing_clamped | Before/After | ghost_lastListingId | SP-47, SP-48, SP-73 |
| oVRFLOBook_buyListing_clamped | Before/After | ghost_lastGrossPrice, ghost_lastGrossPriceRemaining, ghost_lastGrossPriceTtm, ghost_bookFeePaid, ghost_totalBookFees | SP-19, SP-50, SP-75 |
| oVRFLOBook_createBorrowPool_clamped | Before/After | ghost_lastPoolId, ghost_lastLoanId, ghost_borrowReceived, ghost_streamRemainingBeforeBorrow, ghost_lastObligation, ghost_lastObligationBorrowAmount, ghost_lastGrossPrice, ghost_lastGrossPriceRemaining, ghost_lastGrossPriceTtm, ghost_bookFeePaid, ghost_totalBookFees | SP-09, SP-10, SP-13, SP-15, SP-19, SP-22, SP-51, SP-52, SP-53, SP-67, SP-73, SP-77, SP-78, SP-79, SP-80 |
| oVRFLOBook_closeLoan_clamped | Before/After | none | SP-54, SP-55, SP-74 |
| oVRFLOBook_repayLoan_clamped | Before/After | ghost_repayPaid | SP-21, SP-56, SP-57, SP-72 |
| oVRFLOBook_poolClaimLoan_clamped | Before/After | ghost_poolEntitlementSum | SP-20, SP-23, SP-24, SP-25, SP-58, SP-59 |
| oVRFLOBook_claimPoolShare_clamped | Before/After | ghost_poolEntitlementSum | SP-20, SP-23, SP-24, SP-25, SP-60, SP-66 |
| oVRFLOBook_cancelOffer_clamped | Before/After | none | SP-03, SP-45, SP-71 |
| oVRFLOBook_cancelSaleListing_clamped | Before/After | none | SP-04, SP-49, SP-71 |
| oVRFLOBook_secondary | Before/After | none | SP-70 |

### 5.2 New Round-Trip Handlers (for C2 and RT properties)

| Handler | Operations | Snapshots | Properties |
|---------|-----------|-----------|------------|
| roundTrip_wrapUnwrap | wrap(amount) then unwrap(amount) | actorUnderlying, actorOvrfloToken before/after each | SP-01, SP-06 |
| roundTrip_unwrapWrap | unwrap(amount) then wrap(amount) | actorUnderlying, actorOvrfloToken before/after each | SP-02 |
| roundTrip_postOfferCancel | postOffer then cancelOffer | actorUnderlying before/after, ghost_offerFundedCapacity | SP-03 |
| roundTrip_postListingCancel | postSaleListing then cancelSaleListing | streamOwner, streamRemaining before/after | SP-04 |
| roundTrip_depositClaim | deposit then skip to maturity then claim | actorPt, actorUnderlying, actorOvrfloToken, vaultTotalDeposited before/after | SP-05, SP-61 |

### 5.3 New Transfer Handler (for ERC-20 properties)

| Handler | Operations | Snapshots | Properties |
|---------|-----------|-----------|------------|
| oVRFLOToken_transfer | transfer ovrfloToken between actors | actorOvrfloToken, ovrfloTotalSupply before/after | GL-61, GL-62 |

### 5.4 Global Property Functions (property_ prefix, public)

These are called automatically by the fuzzer after every handler call. They do not take handler-specific arguments.

| Property Function | Approach |
|-------------------|----------|
| property_totalSupply_eq_mtd_plus_wrapped (GL-01) | Read totalSupply, marketTotalDeposited, wrappedUnderlying |
| property_wrapped_le_balance (GL-02) | Read wrappedUnderlying, underlying.balanceOf(vault) |
| property_mtd_le_pt_balance (GL-03) | Read marketTotalDeposited, ptToken.balanceOf(vault) |
| property_pool_proceeds_le_token_bal (GL-04) | Iterate 1..nextPoolId-1, sum poolProceeds, compare to ovrfloToken.balanceOf(book) |
| property_offer_capacity_le_underlying_bal (GL-05) | Iterate 1..nextOfferId-1, sum offer.capacity, compare to underlying.balanceOf(book) |
| property_pool_proceeds_eq_token_bal (GL-06) | Same iteration as GL-04, strict equality |
| property_offer_capacity_eq_underlying_bal (GL-07) | Same iteration as GL-05, strict equality |
| property_drawn_repaid_le_obligation (GL-08) | Iterate 1..nextLoanId-1, check drawn+repaid <= obligation |
| property_pool_proceeds_le_obligation (GL-09) | Iterate 1..nextPoolId-1, check poolProceeds <= totalObligation |
| property_loan_obligation_eq_pool (GL-10) | Iterate 1..nextLoanId-1, check loan.obligation == pool.totalObligation |
| property_offer_active_no_revival (GL-11) | Iterate 1..nextOfferId-1, check no active=false->true transition (needs ghost tracking) |
| property_listing_active_no_revival (GL-12) | Iterate 1..nextSaleListingId-1 |
| property_loan_closed_no_revival (GL-13) | Iterate 1..nextLoanId-1 |
| property_pool_active_always (GL-14) | Iterate 1..nextPoolId-1, check pool.active == true |
| property_id_counters_monotonic (GL-15) | Compare current IDs to ghost_last* values, update ghosts |
| property_drawn_monotonic (GL-16) | Iterate 1..nextLoanId-1, compare to ghost mapping |
| property_repaid_monotonic (GL-17) | Iterate 1..nextLoanId-1, compare to ghost mapping |
| property_pool_received_monotonic (GL-18) | Iterate 1..nextPoolId-1 per contributor |
| property_ovrflo_count_monotonic (GL-19) | Compare factory.ovrfloCount to ghost |
| property_book_count_monotonic (GL-20) | Compare factory.bookCount to ghost |
| property_approved_market_count_monotonic (GL-21) | Compare to ghost |
| property_pool_exists_iff_pool_loan_id (GL-22) | Iterate 1..nextPoolId-1 |
| property_loan_exists_iff_loan_pool_id (GL-23) | Iterate 1..nextLoanId-1 |
| property_pool_loan_id_iff_loan_pool_id (GL-24) | Iterate 1..nextPoolId-1 |
| property_offer_slot_iff_id (GL-25) | Iterate 1..nextOfferId-1, check maker != address(0) |
| property_loan_slot_iff_id (GL-26) | Iterate 1..nextLoanId-1, check borrower != address(0) |
| property_pool_slot_iff_id (GL-27) | Iterate 1..nextPoolId-1, check creator != address(0) |
| property_listing_slot_iff_id (GL-28) | Iterate 1..nextSaleListingId-1, check maker != address(0) |
| property_underlying_to_ovrflo_oneshot (GL-29) | Check factory.underlyingToOvrflo[underlying] == address(vault) |
| property_ovrflo_to_book_iff (GL-30) | Check factory.ovrfloToBook[vault] == address(book) and reverse |
| property_closed_implies_satisfied (GL-31) | Iterate 1..nextLoanId-1, if closed check drawn+repaid==obligation |
| property_offer_active_iff_capacity (GL-32) | Iterate 1..nextOfferId-1, check active == (capacity > 0) |
| property_loan_obligation_immutable (GL-33) | Iterate, compare to ghost mapping of initial values |
| property_loan_stream_id_immutable (GL-34) | Same approach |
| property_loan_parties_immutable (GL-35) | Same approach |
| property_offer_maker_apr_immutable (GL-36) | Same approach |
| property_listing_fee_immutable (GL-37) | Same approach |
| property_pool_total_contributed_immutable (GL-38) | Same approach |
| property_pool_total_obligation_immutable (GL-39) | Same approach |
| property_pool_contributions_immutable (GL-40) | Same approach |
| property_series_immutable (GL-41) | Call vault.series(market), compare to ghost |
| property_pt_to_market_immutable (GL-42) | Call vault.ptToMarket(ptToken), compare to ghost |
| property_gross_price_floors (GL-43) | Call StreamPricing.grossPrice with random inputs, verify floor |
| property_obligation_ceils (GL-44) | Call StreamPricing.obligation with random inputs, verify ceil |
| property_factor_ge_wad (GL-45) | Call StreamPricing.factor with random inputs |
| property_wrap_zero_reverts (GL-46) | try vault.wrap(0), expect revert |
| property_unwrap_zero_reverts (GL-47) | try vault.unwrap(0), expect revert |
| property_deposit_min_reverts (GL-48) | try vault.deposit(market, MIN_PT_AMOUNT-1, 0), expect revert |
| property_claim_zero_reverts (GL-49) | try vault.claim(ptToken, 0), expect revert |
| property_post_offer_zero_reverts (GL-50) | try book.postOffer(market, apr, 0), expect revert |
| property_touser_monotonic (GL-51) | Compare ghost_lastToUser / ghost_lastDepositPtAmount to new values |
| property_gross_price_monotonic_remaining (GL-52) | Compare ghost_lastGrossPrice / ghost_lastGrossPriceRemaining |
| property_obligation_monotonic_borrow (GL-53) | Compare ghost_lastObligation / ghost_lastObligationBorrowAmount |
| property_gross_price_nonincreasing_ttm (GL-54) | Compare ghost_lastGrossPrice / ghost_lastGrossPriceTtm |
| property_pure_wrapper_can_unwrap (GL-55) | For each actor with ghost_hasWrapped && !ghost_hasDeposited, check unwrap feasibility |
| property_depositor_can_claim (GL-56) | For each actor with ghost_hasDeposited, check claim feasibility |
| property_no_free_profit (GL-57) | Sum actor values, compare to ghost_actorStartValue + legitimate yield |
| property_zero_state_after_withdraw (GL-58) | Check if all actors have 0 ovrfloToken, then totalSupply==0, MTD==0, wrapped==0 |
| property_no_orphaned_wrap_reserve (GL-59) | Check wrappedUnderlying >= sum of wrapped-only actor balances |
| property_total_supply_eq_holder_sum (GL-60) | Sum ovrfloToken balances of actors + vault + book + treasury, compare to totalSupply |
| property_self_transfer_no_change (GL-61) | Requires transfer handler: check balance/supply unchanged after self-transfer |
| property_zero_transfer_no_change (GL-62) | Requires transfer handler: check state unchanged after 0-amount transfer |
| property_sum_outstanding_le_remaining (GL-63) | Iterate 1..nextLoanId-1, sum outstanding, sum stream remaining, compare |

---

## 6. Iteration Approach for Aggregation Properties

Several global properties require iterating over all offers, loans, pools, or listings. The approach:

1. **Bounded iteration**: IDs start at 1 and increment monotonically. Iterate from 1 to `nextXId - 1`.
2. **Gas cost**: Bounded by the number of entities created during the fuzz run. For Echidna/Medusa with ~1000 calls, this is typically < 100 entities. Acceptable.
3. **Revert safety**: Each entity read is a public mapping accessor that cannot revert for initialized slots.
4. **Immutability ghost tracking**: For GL-33..GL-40, store a `mapping(uint256 => uint256)` ghost of the initial value keyed by entity ID. On each global check, compare current to stored.

### Monotonicity Ghost Mappings

For per-entity monotonicity (GL-16, GL-17, GL-18), use additional mapping ghosts:
- `mapping(uint256 => uint128) ghost_loanDrawnSnapshot` — updated each global check
- `mapping(uint256 => uint128) ghost_loanRepaidSnapshot` — updated each global check
- `mapping(uint256 => mapping(address => uint128)) ghost_poolReceivedSnapshot` — updated each global check

These are in addition to the 29 ghost variables listed above and should be added as separate storage variables in Base.sol.

---

## 7. Excluded Properties

| Source | Reason |
|--------|--------|
| RD-04 (wrap/unwrap same conversion) | Purely informational, no runtime assertion |
| ST-45 (deploy pending=false) | Factory set up once in Base.sol, not fuzzed |
| ST-46 (deploy underlyingToOvrflo set) | Factory set up once, not fuzzed |
| ST-47 (deployBook bookCount+1) | Factory set up once, not fuzzed |
| ST-48 (deployBook one-shot) | Factory set up once, not fuzzed |
| ST-49 (addMarket count+1) | Factory set up once, not fuzzed |
| ST-50 (cancelDeployment pending=false) | Factory set up once, not fuzzed |

---

## 8. Deduplication Map

| Merged Property | Sources |
|----------------|---------|
| GL-01 | CON-01, SPEC-V01, SPEC-V02 |
| GL-08 | CON-07, SPEC-L06, VS-11 |
| GL-09 | CON-09, SPEC-L07 |
| GL-10 | CON-12 |
| GL-13 | ST-31, ST-43 |
| GL-15 | VT-01, VT-02, VT-03, VT-04, SPEC-Q02 |
| GL-25 | VS-04 |
| GL-26 | VS-05 |
| GL-27 | VS-06 |
| GL-28 | VS-07 |
| GL-31 | VS-10, ADV-20 |
| GL-32 | VS-12, SPEC-Q03 |
| GL-41 | ST-11, VS-21 |
| GL-42 | ST-12, VS-22 |
| SP-01 | RT-01, RT-11, SPEC-V05 |
| SP-02 | RT-02, RT-12 |
| SP-05 | RT-05 |
| SP-07 | RT-07, RD-10, RD-11, SPEC-V04 |
| SP-08 | RT-08, SPEC-V06 |
| SP-10 | RT-10, RD-08 |
| SP-19 | RD-16 |
| SP-22 | CON-04, SPEC-L05 |
| SP-23 | CON-05, ADV-19 |
| SP-24 | CON-06, ADV-12, ADV-19 |
| SP-25 | CON-08 |
| SP-36 | ST-13, ADV-18 |
| SP-54 | ST-32, SPEC-L03 |
| SP-57 | ST-35, ST-36 |

---

## 9. Summary Statistics

- **Total properties**: 143 (63 global + 80 specific)
- **Priority**: 84 HIGH, 41 MEDIUM, 18 LOW
- **Guarantee**: 113 SHOULD-HOLD, 30 EXPLORATORY
- **Categories**: 65 VALID_STATE, 39 STATE_TRANSITION, 21 VARIABLE_TRANSITION, 18 HIGH_LEVEL
- **Ghosts**: 29 variables (26 struct fields + 3 mappings)
- **Snapshot fields**: 28
- **Handler wiring**: 24 handlers (18 existing + 5 round-trip + 1 transfer)
- **Excluded**: 7 (1 informational + 6 factory deployment)
