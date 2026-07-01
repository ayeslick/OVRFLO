# Agent Output Summary for Synthesizer

## Agent 1: Conservation Auditor (14 properties)

CON-01 | GLOBAL | totalSupply == marketTotalDeposited + wrappedUnderlying | HIGH | SHOULD-HOLD (I-1 delta-pair: deposit +ptAmount both, claim -amount both, wrap +amount both, unwrap -amount both) | Ghosts: none | Snapshots: none
CON-02 | GLOBAL | wrappedUnderlying <= underlying.balanceOf(vault) | HIGH | SHOULD-HOLD (I-7: wrap/unwrap delta pairs, sweep only takes excess) | Ghosts: none | Snapshots: none
CON-03 | GLOBAL | marketTotalDeposited <= ptToken.balanceOf(vault) at rest | HIGH | SHOULD-HOLD (I-8: deposit/claim delta pairs, flashLoan atomic, sweep only takes excess) | Ghosts: none | Snapshots: none
CON-04 | SPECIFIC (after createBorrowPool) | sum(poolContributions[poolId][i]) == pools[poolId].totalContributed | HIGH | SHOULD-HOLD (_consumeOffers sums to actualBorrow, never modified after) | Ghosts: none | Snapshots: none
CON-05 | SPECIFIC | sum(poolReceived[poolId][i]) <= pools[poolId].totalObligation | HIGH | SHOULD-HOLD (I-14: each poolReceived <= entitlement, sum entitlements <= totalObligation) | Ghosts: none | Snapshots: none
CON-06 | SPECIFIC | poolReceived[poolId][i] <= entitlement (contribution * totalObligation / totalContributed) | HIGH | SHOULD-HOLD (E-3: pro-rata cap enforced in both claim channels) | Ghosts: none | Snapshots: none
CON-07 | SPECIFIC | drawn + repaid <= obligation for every loan | HIGH | SHOULD-HOLD (all increments capped at outstanding) | Ghosts: none | Snapshots: none
CON-08 | SPECIFIC | poolProceeds + sum(poolReceived) == drawn + repaid (exact conservation) | HIGH | SHOULD-HOLD (delta-pair: poolClaimLoan +drawAmount both, closeLoan +outstanding both, repayLoan +amount both, claimPoolShare net zero) | Ghosts: none | Snapshots: none
CON-09 | SPECIFIC | poolProceeds <= totalObligation | MEDIUM | SHOULD-HOLD (derived from CON-07 + CON-08) | Ghosts: none | Snapshots: none
CON-10 | GLOBAL | sum(poolProceeds) <= ovrfloToken.balanceOf(book) | HIGH | SHOULD-HOLD (Pattern B: internal accounting <= external reality) | Ghosts: none | Snapshots: none
CON-11 | GLOBAL | sum(offer.capacity) <= underlying.balanceOf(book) | HIGH | SHOULD-HOLD (Pattern B: offer capacity backed by underlying) | Ghosts: none | Snapshots: none
CON-12 | SPECIFIC | loan.obligation == pool.totalObligation for pool loans | MEDIUM | SHOULD-HOLD (both set from same variable at creation, never modified) | Ghosts: none | Snapshots: none
CON-13 | GLOBAL | sum(poolProceeds) == ovrfloToken.balanceOf(book) (strict, harness only) | MEDIUM | EXPLORATORY (true if no direct transfers to book) | Ghosts: none | Snapshots: none
CON-14 | GLOBAL | sum(offer.capacity) == underlying.balanceOf(book) (strict, harness only) | HIGH | EXPLORATORY (true if no direct transfers to book) | Ghosts: none | Snapshots: none

## Agent 2: Round-Trip & Rounding Analyst (40 properties)

RT-01 | SPECIFIC | wrap→unwrap returns exactly same underlying | HIGH | SHOULD-HOLD (wrap/unwrap exact 1:1, no mulDiv) | Snapshots: actorUnderlying, actorOvrfloToken
RT-02 | SPECIFIC | unwrap→wrap returns exactly same ovrfloToken | HIGH | SHOULD-HOLD (same as RT-01) | Snapshots: actorUnderlying, actorOvrfloToken
RT-03 | SPECIFIC | postOffer→cancelOffer returns exactly same capacity | HIGH | SHOULD-HOLD (_pullExact + _payUnderlying exact) | Ghosts: ghostOfferFundedCapacity | Snapshots: actorUnderlying
RT-04 | SPECIFIC | postSaleListing→cancelSaleListing returns stream unchanged | MEDIUM | SHOULD-HOLD (transferFrom reversible, no stream modification) | Snapshots: streamRemaining, streamOwner
RT-05 | SPECIFIC | deposit→claim cycle conserves value (PT recovered, fee is only loss) | HIGH | SHOULD-HOLD (toUser+toStream=ptAmount, claim 1:1) | Ghosts: ghostDepositFeePaid | Snapshots: actorPt, actorUnderlying, actorOvrfloToken
RT-06 | SPECIFIC | N cycles of wrap→unwrap don't increase balance (C2 dust extraction) | HIGH | SHOULD-HOLD (exact 1:1, no rounding) | Snapshots: actorUnderlying, actorOvrfloToken
RT-07 | SPECIFIC | deposit conserves: toUser+toStream=ptAmount | MEDIUM | SHOULD-HOLD (exact subtraction, not second mulDiv) | Ghosts: ghostTotalOvrfloMintedFromDeposits | Snapshots: actorOvrfloToken
RT-08 | SPECIFIC | flash loan atomically repaid, vault never loses PT | HIGH | SHOULD-HOLD (nonReentrant, exact return + fee) | Ghosts: ghostFlashFeePaid | Snapshots: actorPt, actorUnderlying, vaultPtBalance
RT-09 | SPECIFIC | borrow→repay: obligation >= actualBorrow (no free value) | HIGH | SHOULD-HOLD (factor >= WAD, obligation ceils) | Ghosts: ghostBorrowReceived, ghostRepayPaid | Snapshots: actorUnderlying, actorOvrfloToken
RT-10 | SPECIFIC | borrow→closeLoan: obligation <= remaining (stream covers debt) | HIGH | SHOULD-HOLD (grossPrice floors, obligation ceils, NatSpec) | Ghosts: ghostStreamRemainingBeforeBorrow | Snapshots: actorUnderlying, streamRemaining
RT-11 | SPECIFIC | unwrap(wrap(x)) == x (conversion consistency) | HIGH | SHOULD-HOLD (1:1, no mulDiv) | Snapshots: actorUnderlying, actorOvrfloToken
RT-12 | SPECIFIC | wrap(unwrap(x)) == x (conversion consistency reverse) | HIGH | SHOULD-HOLD (same) | Snapshots: actorUnderlying, actorOvrfloToken
RD-01 | SPECIFIC | previewDeposit matches actual deposit (same block, fixed oracle) | MEDIUM | SHOULD-HOLD (same code path, fixed mock rate) | Snapshots: actorOvrfloToken, actorUnderlying
RD-02 | SPECIFIC | previewStream matches actual deposit split | MEDIUM | SHOULD-HOLD (same code path) | Snapshots: actorOvrfloToken
RD-03 | SPECIFIC | quote matches actual createBorrowPool obligation | MEDIUM | SHOULD-HOLD (same pricing path) | Snapshots: poolTotalObligation, poolTotalContributed
RD-04 | GLOBAL | wrap/unwrap use same conversion (identity, no asymmetry) | LOW | SHOULD-HOLD (no mulDiv in either) | Ghosts: none | Snapshots: none
RD-05 | GLOBAL | deposit floors toUser, claim exact 1:1 (intentional asymmetry) | MEDIUM | SHOULD-HOLD (toStream=ptAmount-toUser captures dust) | Snapshots: actorPt, actorOvrfloToken
RD-06 | GLOBAL | grossPrice always floors (buyer pays less) | HIGH | SHOULD-HOLD (PRBMath.mulDiv floors, NatSpec) | Ghosts: none | Snapshots: none
RD-07 | GLOBAL | obligation always ceils (lender owed more) | HIGH | SHOULD-HOLD (explicit +1 on remainder, NatSpec) | Ghosts: none | Snapshots: none
RD-08 | GLOBAL | obligation <= remaining in partial-borrow path | HIGH | SHOULD-HOLD (mathematical proof, NatSpec) | Ghosts: none | Snapshots: none
RD-09 | GLOBAL | full-borrow fast-path returns remaining exactly | HIGH | SHOULD-HOLD (obligationForFill code, NatSpec) | Ghosts: none | Snapshots: none
RD-10 | GLOBAL | deposit toUser floored, remainder in toStream (no value lost) | HIGH | SHOULD-HOLD (toStream=ptAmount-toUser exact) | Snapshots: actorOvrfloToken
RD-11 | GLOBAL | deposit conserves: toUser+toStream=ptAmount exactly | HIGH | SHOULD-HOLD (exact subtraction) | Ghosts: ghostTotalOvrfloMintedFromDeposits | Snapshots: vaultTotalDeposited
RD-12 | GLOBAL | claim is exact 1:1 burn/transfer | HIGH | SHOULD-HOLD (no mulDiv, literal amount) | Snapshots: actorPt, actorOvrfloToken
RD-13 | GLOBAL | deposit toUser capped at ptAmount (rate > 1 reverts) | MEDIUM | SHOULD-HOLD (cap + toStream>0 guard) | Ghosts: none | Snapshots: none
RD-14 | GLOBAL | deposit fee floored (protocol never overcharges) | MEDIUM | SHOULD-HOLD (PRBMath.mulDiv floors) | Ghosts: ghostDepositFeePaid | Snapshots: actorUnderlying
RD-15 | GLOBAL | flash loan fee double-floored | MEDIUM | SHOULD-HOLD (two nested mulDiv) | Ghosts: ghostFlashFeePaid | Snapshots: actorUnderlying, vaultPtBalance
RD-16 | GLOBAL | book fee floored (StreamPricing.fee) | MEDIUM | SHOULD-HOLD (mulDiv floors) | Ghosts: ghostBookFeePaid | Snapshots: actorUnderlying
RD-17 | GLOBAL | pro-rata entitlement floored (protocol-favorable) | MEDIUM | EXPLORATORY (Solidity integer division, not documented) | Ghosts: ghostPoolEntitlementSum | Snapshots: poolProceeds
RD-18 | GLOBAL | repayLoan equality check exact (no rounding brick) | MEDIUM | SHOULD-HOLD (exact integer, NatSpec) | Snapshots: loanObligation, loanDrawn, loanRepaid
RD-19 | GLOBAL | wrap(0) reverts | LOW | SHOULD-HOLD (require amount > 0) | Ghosts: none | Snapshots: none
RD-20 | GLOBAL | unwrap(0) reverts | LOW | SHOULD-HOLD (require amount > 0) | Ghosts: none | Snapshots: none
RD-21 | GLOBAL | deposit below MIN_PT_AMOUNT reverts | LOW | SHOULD-HOLD (require >= MIN_PT_AMOUNT) | Ghosts: none | Snapshots: none
RD-22 | GLOBAL | claim(0) reverts | LOW | SHOULD-HOLD (require amount > 0) | Ghosts: none | Snapshots: none
RD-23 | GLOBAL | postOffer(0) reverts | LOW | SHOULD-HOLD (require capacity > 0) | Ghosts: none | Snapshots: none
RD-24 | GLOBAL | toUser monotonic in ptAmount | LOW | SHOULD-HOLD (mulDiv monotonic) | Ghosts: none | Snapshots: none
RD-25 | GLOBAL | grossPrice monotonic in remaining | LOW | SHOULD-HOLD (mulDiv monotonic) | Ghosts: none | Snapshots: none
RD-26 | GLOBAL | obligation monotonic in borrowAmount | LOW | SHOULD-HOLD (ceil monotonic) | Ghosts: none | Snapshots: none
RD-27 | GLOBAL | grossPrice non-increasing in timeToMaturity | LOW | SHOULD-HOLD (factor increases) | Ghosts: none | Snapshots: none
RD-28 | GLOBAL | factor >= WAD always | LOW | SHOULD-HOLD (WAD + non-negative term, NatSpec) | Ghosts: none | Snapshots: none

## Agent 3: State Transition Mapper (82 properties)

### Postconditions (ST-01 to ST-50)
ST-01 | SPECIFIC (after deposit) | marketTotalDeposited increases by ptAmount | HIGH | SHOULD-HOLD (explicit assignment)
ST-02 | SPECIFIC (after deposit) | wrappedUnderlying unchanged | MEDIUM | EXPLORATORY
ST-03 | SPECIFIC (after deposit) | deposit only pre-maturity | HIGH | SHOULD-HOLD (require)
ST-04 | SPECIFIC (after claim) | marketTotalDeposited decreases by amount | HIGH | SHOULD-HOLD
ST-05 | SPECIFIC (after claim) | claim only post-maturity | HIGH | SHOULD-HOLD
ST-06 | SPECIFIC (after claim) | wrappedUnderlying unchanged | MEDIUM | EXPLORATORY
ST-07 | SPECIFIC (after wrap) | wrappedUnderlying increases by amount | HIGH | SHOULD-HOLD
ST-08 | SPECIFIC (after unwrap) | wrappedUnderlying decreases by amount | HIGH | SHOULD-HOLD
ST-09 | SPECIFIC (after wrap) | marketTotalDeposited unchanged | MEDIUM | EXPLORATORY
ST-10 | SPECIFIC (after unwrap) | marketTotalDeposited unchanged | MEDIUM | EXPLORATORY
ST-11 | SPECIFIC (after setSeriesApproved) | series config one-shot, never overwritten | HIGH | SHOULD-HOLD
ST-12 | SPECIFIC (after setSeriesApproved) | ptToMarket one-shot | HIGH | SHOULD-HOLD
ST-13 | SPECIFIC (after flashLoan) | marketTotalDeposited unchanged | HIGH | EXPLORATORY
ST-14 | SPECIFIC (after flashLoan) | flash loan only pre-maturity | HIGH | SHOULD-HOLD
ST-15 | SPECIFIC (after flashLoan) | wrappedUnderlying unchanged | MEDIUM | EXPLORATORY
ST-16 | SPECIFIC (after sweepExcessPt) | marketTotalDeposited unchanged | MEDIUM | EXPLORATORY
ST-17 | SPECIFIC (after sweepExcessUnderlying) | wrappedUnderlying unchanged | MEDIUM | EXPLORATORY
ST-18 | SPECIFIC (after setFlashFeeBps) | flashFeeBps equals arg, <= max | LOW | SHOULD-HOLD
ST-19 | SPECIFIC (after setFlashLoanPaused) | flashLoanPaused equals arg | LOW | SHOULD-HOLD
ST-20 | SPECIFIC (after postOffer) | nextOfferId increments by 1 | HIGH | SHOULD-HOLD
ST-21 | SPECIFIC (after postOffer) | new offer active, capacity > 0, maker == sender | HIGH | SHOULD-HOLD
ST-22 | SPECIFIC (after cancelOffer) | offer inactive, capacity == 0 | HIGH | SHOULD-HOLD
ST-23 | SPECIFIC (after sellIntoOffer) | capacity decreases by grossPrice, active=false only when capacity==0 | HIGH | SHOULD-HOLD
ST-24 | SPECIFIC (after postSaleListing) | nextSaleListingId increments by 1 | HIGH | SHOULD-HOLD
ST-25 | SPECIFIC (after postSaleListing) | listing active, feeBps snapshotted | MEDIUM | SHOULD-HOLD
ST-26 | SPECIFIC (after cancelSaleListing) | listing inactive | HIGH | SHOULD-HOLD
ST-27 | SPECIFIC (after buyListing) | listing inactive | HIGH | SHOULD-HOLD
ST-28 | SPECIFIC (after createBorrowPool) | nextPoolId and nextLoanId each +1 | HIGH | SHOULD-HOLD
ST-29 | SPECIFIC (after createBorrowPool) | pool active, loan closed=false, drawn=0, repaid=0 | HIGH | SHOULD-HOLD
ST-30 | SPECIFIC (after createBorrowPool) | poolContributions set for consumed offer makers | HIGH | SHOULD-HOLD
ST-31 | SPECIFIC (after closeLoan) | loan.closed false→true (one-shot) | HIGH | SHOULD-HOLD
ST-32 | SPECIFIC (after closeLoan) | drawn += outstanding, poolProceeds += outstanding (if >0) | HIGH | SHOULD-HOLD
ST-33 | SPECIFIC (after closeLoan outstanding==0) | drawn and poolProceeds unchanged | MEDIUM | SHOULD-HOLD
ST-34 | SPECIFIC (after repayLoan) | repaid += amount, poolProceeds += amount | HIGH | SHOULD-HOLD
ST-35 | SPECIFIC (after repayLoan) | closed=true iff amount==outstanding | HIGH | SHOULD-HOLD
ST-36 | SPECIFIC (after repayLoan partial) | closed remains false | HIGH | SHOULD-HOLD
ST-37 | SPECIFIC (after poolClaimLoan) | drawn += drawAmount, poolReceived += drawAmount | HIGH | SHOULD-HOLD
ST-38 | SPECIFIC (after poolClaimLoan) | poolProceeds unchanged | MEDIUM | EXPLORATORY
ST-39 | SPECIFIC (after claimPoolShare) | poolReceived += amount, poolProceeds -= amount | HIGH | SHOULD-HOLD
ST-40 | SPECIFIC (paired deposit→claim) | marketTotalDeposited returns to pre-deposit | MEDIUM | EXPLORATORY
ST-41 | GLOBAL | offer.active never false→true | HIGH | SHOULD-HOLD
ST-42 | GLOBAL | saleListing.active never false→true | HIGH | SHOULD-HOLD
ST-43 | GLOBAL | loan.closed never true→false | HIGH | SHOULD-HOLD
ST-44 | GLOBAL | pool.active always true for existing pools | MEDIUM | EXPLORATORY
ST-45 | SPECIFIC (after deploy) | pending=false, ovrfloCount+1 | MEDIUM | SHOULD-HOLD
ST-46 | SPECIFIC (after deploy) | underlyingToOvrflo set | HIGH | SHOULD-HOLD
ST-47 | SPECIFIC (after deployBook) | bookCount+1, ovrfloToBook set | MEDIUM | SHOULD-HOLD
ST-48 | SPECIFIC (after deployBook) | one-shot per vault | HIGH | SHOULD-HOLD
ST-49 | SPECIFIC (after addMarket) | approvedMarketCount+1, isMarketApproved=true | MEDIUM | SHOULD-HOLD
ST-50 | SPECIFIC (after cancelDeployment) | pending=false | LOW | SHOULD-HOLD

### Monotonicity (VT-01 to VT-10)
VT-01 | GLOBAL | nextOfferId never decreases | HIGH | SHOULD-HOLD (only ++)
VT-02 | GLOBAL | nextSaleListingId never decreases | HIGH | SHOULD-HOLD
VT-03 | GLOBAL | nextLoanId never decreases | HIGH | SHOULD-HOLD
VT-04 | GLOBAL | nextPoolId never decreases | HIGH | SHOULD-HOLD
VT-05 | GLOBAL | loan.drawn never decreases | HIGH | SHOULD-HOLD
VT-06 | GLOBAL | loan.repaid never decreases | HIGH | SHOULD-HOLD
VT-07 | GLOBAL | poolReceived[poolId][contributor] never decreases | HIGH | SHOULD-HOLD
VT-08 | GLOBAL | factory.ovrfloCount never decreases | MEDIUM | SHOULD-HOLD
VT-09 | GLOBAL | factory.bookCount never decreases | MEDIUM | SHOULD-HOLD
VT-10 | GLOBAL | factory.approvedMarketCount never decreases | MEDIUM | SHOULD-HOLD

### State Sync (VS-01 to VS-22)
VS-01 | GLOBAL | pool exists iff poolLoanId != 0 | HIGH | SHOULD-HOLD (I-18)
VS-02 | GLOBAL | loan exists iff loanPoolId != 0 | HIGH | SHOULD-HOLD
VS-03 | GLOBAL | poolLoanId[poolId]==loanId iff loanPoolId[loanId]==poolId | HIGH | SHOULD-HOLD
VS-04 | GLOBAL | offer slot populated iff id < nextOfferId | HIGH | SHOULD-HOLD
VS-05 | GLOBAL | loan slot populated iff id < nextLoanId | HIGH | SHOULD-HOLD
VS-06 | GLOBAL | pool slot populated iff id < nextPoolId | HIGH | SHOULD-HOLD
VS-07 | GLOBAL | listing slot populated iff id < nextSaleListingId | HIGH | SHOULD-HOLD
VS-08 | GLOBAL | underlyingToOvrflo one-shot | HIGH | SHOULD-HOLD (I-10)
VS-09 | GLOBAL | ovrfloToBook iff bookToOvrflo | MEDIUM | SHOULD-HOLD
VS-10 | GLOBAL | loan.closed → drawn+repaid==obligation | HIGH | SHOULD-HOLD
VS-11 | GLOBAL | drawn+repaid <= obligation always | HIGH | SHOULD-HOLD
VS-12 | GLOBAL | offer.active iff capacity > 0 | HIGH | SHOULD-HOLD
VS-13 | GLOBAL | loan.obligation immutable after creation | HIGH | EXPLORATORY
VS-14 | GLOBAL | loan.streamId immutable | HIGH | EXPLORATORY
VS-15 | GLOBAL | loan.borrower/lender immutable | HIGH | EXPLORATORY
VS-16 | GLOBAL | offer.maker/aprBps immutable | MEDIUM | EXPLORATORY
VS-17 | GLOBAL | listing.feeBps immutable (snapshot) | MEDIUM | EXPLORATORY
VS-18 | GLOBAL | pool.totalContributed immutable | HIGH | EXPLORATORY
VS-19 | GLOBAL | pool.totalObligation immutable | HIGH | EXPLORATORY
VS-20 | GLOBAL | poolContributions immutable after creation | HIGH | EXPLORATORY
VS-21 | GLOBAL | series ptToken/expiryCached/feeBps immutable (I-9) | HIGH | SHOULD-HOLD
VS-22 | GLOBAL | ptToMarket immutable, reverse of series.ptToken | HIGH | SHOULD-HOLD

## Agent 4: Adversarial Profit Maximizer (25 properties)

ADV-01 | GLOBAL | Pure wrapper can always unwrap (reserve not drained by depositors) | HIGH | EXPLORATORY | Ghosts: hasDeposited, hasWrapped, totalWrappedBy, totalUnwrappedBy
ADV-02 | GLOBAL | Depositor can always claim PT (MTD not drained by wrap-then-claim) | HIGH | EXPLORATORY | Ghosts: hasDeposited, depositDerivedBalance
ADV-03 | SPECIFIC | deposit liveness: valid preconditions → must succeed | HIGH | SHOULD-HOLD | Ghosts: depositAmount, success
ADV-04 | GLOBAL | No free profit: actor value <= start + legitimate yield | HIGH | EXPLORATORY | Ghosts: startValue, legitimateYield
ADV-05 | SPECIFIC | No share inflation (fixed-rate, not share-based) | MEDIUM | SHOULD-HOLD | Ghosts: lastToUser, lastDepositAmt
ADV-06 | SPECIFIC | Flash loan: borrower net value <= before | HIGH | SHOULD-HOLD | Ghosts: flashLoanValBefore, flashLoanValAfter
ADV-07 | GLOBAL | After all withdraw: totalSupply==0, MTD==0, wrappedUnderlying==0 | MEDIUM | SHOULD-HOLD
ADV-08 | SPECIFIC | Dust ovrfloToken position has exit path | MEDIUM | EXPLORATORY
ADV-09 | SPECIFIC | Dust contributor not bricked by truncation (entitlement > 0) | MEDIUM | EXPLORATORY
ADV-10 | SPECIFIC | No uint128 overflow in pool accounting | MEDIUM | SHOULD-HOLD
ADV-11 | SPECIFIC | Full-amount operations safe (entire balance in one call) | MEDIUM | SHOULD-HOLD | Ghosts: lastAction, unwrapAmount, etc.
ADV-12 | SPECIFIC | Cumulative pool claims <= entitlement (dual-channel bypass) | HIGH | SHOULD-HOLD
ADV-13 | SPECIFIC | Non-admin cannot call vault admin functions | HIGH | SHOULD-HOLD
ADV-14 | SPECIFIC | Non-owner cannot call book admin functions | HIGH | SHOULD-HOLD
ADV-15 | SPECIFIC | Non-maker cannot cancel offer/listing | HIGH | SHOULD-HOLD
ADV-16 | SPECIFIC | Non-borrower cannot repayLoan | HIGH | SHOULD-HOLD
ADV-17 | SPECIFIC | Stream owner only (no stream theft) | HIGH | SHOULD-HOLD | Ghosts: streamOwnerMatch
ADV-18 | SPECIFIC | Flash loan doesn't inflate MTD without backing PT | MEDIUM | SHOULD-HOLD | Ghosts: lastAction, mtdBefore, vaultPtBefore
ADV-19 | SPECIFIC | Dual-channel no excess (collective + per-contributor) | HIGH | SHOULD-HOLD
ADV-20 | SPECIFIC | closeLoan no over-draw (drawn+repaid==obligation after close) | HIGH | SHOULD-HOLD
ADV-21 | SPECIFIC | closeLoan no grief (poolProceeds sufficient for lender) | MEDIUM | EXPLORATORY | Ghosts: proceedsClaimed
ADV-22 | SPECIFIC | Offer consumed correctly (sale or loan, value to maker) | MEDIUM | EXPLORATORY | Ghosts: offerSoldTo
ADV-23 | SPECIFIC | Low deposit limit doesn't brick claims | MEDIUM | SHOULD-HOLD
ADV-24 | SPECIFIC | No self-match bypass (borrower not contributor to own pool) | HIGH | SHOULD-HOLD
ADV-25 | GLOBAL | No orphaned wrap reserve (wrap-then-claim locks underlying) | HIGH | EXPLORATORY | Ghosts: totalWrapMinted, totalWrapBurned

## Agent 5: Protocol-Type Specialist (19 properties)

SPEC-V01 | GLOBAL | totalSupply == deposited + wrapped (no direct transfer inflation) | MEDIUM | SHOULD-HOLD (I-1)
SPEC-V02 | SPECIFIC | No donation inflation (mint independent of vault balance) | HIGH | SHOULD-HOLD (deposit formula uses only ptAmount + rate) | Snapshots: lastToUser, lastToStream, lastPtAmount
SPEC-V03 | SPECIFIC | First deposit on fresh market succeeds (zero-supply safe) | LOW | EXPLORATORY | Snapshots: lastToUser, lastToStream, lastPtAmount
SPEC-V04 | SPECIFIC | Deposit conservative: toUser+toStream=ptAmount, toStream>0 | HIGH | SHOULD-HOLD | Snapshots: lastToUser, lastToStream, lastPtAmount, supplyBefore
SPEC-V05 | SPECIFIC | Wrap/unwrap strictly 1:1 and conservative | HIGH | SHOULD-HOLD | Snapshots: wrappedUnderlyingBefore, ovrfloBalBefore, underlyingBalBefore
SPEC-V06 | SPECIFIC | Flash loan: vault PT balance unchanged after | MEDIUM | SHOULD-HOLD | Snapshots: ptBalanceBefore, depositedBefore
SPEC-L01 | GLOBAL | Sum outstanding <= sum remaining face values | LOW | EXPLORATORY | Ghosts: ghost_totalActiveObligation
SPEC-L02 | SPECIFIC | No loan on zero-remaining stream | MEDIUM | SHOULD-HOLD (requireEligible reverts) | Snapshots: lastLoanId
SPEC-L03 | SPECIFIC | closeLoan draws exactly outstanding, zeroes debt | HIGH | SHOULD-HOLD | Snapshots: lastLoanId, outstandingBefore, drawnBefore
SPEC-L04 | SPECIFIC | borrowAmount <= grossPrice (LTV check) | HIGH | SHOULD-HOLD (require) | Snapshots: lastPoolId, grossPriceAtOrigination
SPEC-L05 | SPECIFIC | sum(poolContributions) == totalContributed | MEDIUM | SHOULD-HOLD | Ghosts: ghost_poolContributionSum | Snapshots: lastPoolId
SPEC-L06 | GLOBAL | drawn + repaid <= obligation (lifetime) | HIGH | SHOULD-HOLD
SPEC-L07 | GLOBAL | poolProceeds <= totalObligation | MEDIUM | SHOULD-HOLD
SPEC-Q01 | SPECIFIC | Offer IDs strictly increasing, sorted input required | MEDIUM | SHOULD-HOLD (pattern #11)
SPEC-Q02 | GLOBAL | All 4 ID counters monotonic non-decreasing | MEDIUM | SHOULD-HOLD | Ghosts: ghost_lastNextOfferId, etc.
SPEC-Q03 | GLOBAL | Inactive offers have capacity == 0 | LOW | SHOULD-HOLD
SPEC-T01 | GLOBAL | totalSupply == sum of all known holder balances | HIGH | SHOULD-HOLD (ERC-20 standard)
SPEC-T02 | GLOBAL | Self-transfer doesn't change balance/supply | MEDIUM | SHOULD-HOLD (ERC-20)
SPEC-T03 | GLOBAL | Zero-amount transfer doesn't change state | MEDIUM | SHOULD-HOLD (ERC-20)
