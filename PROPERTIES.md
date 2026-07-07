# OVRFLO Fuzz Properties

Consolidated from 5 invariant discovery agents (Conservation Auditor, Round-Trip & Rounding Analyst, State Transition Mapper, Adversarial Profit Maximizer, Protocol-Type Specialist).

- **Scope**: GLOBAL = checked after every handler call (`property_` prefix, public); SPECIFIC = checked at end of relevant handler (internal).
- **Category**: VALID_STATE, STATE_TRANSITION, VARIABLE_TRANSITION, HIGH_LEVEL.
- **Guarantee**: SHOULD-HOLD (documented/spec/standard with evidence) or EXPLORATORY (inferred from code/patterns).
- **Priority**: HIGH, MEDIUM, LOW.

---

## Global Properties

### Conservation & Solvency

- [x] **GL-01** totalSupply == marketTotalDeposited + wrappedUnderlying (no direct-transfer inflation). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: I-1 delta-pair (deposit +ptAmount both, claim -amount both, wrap +amount both, unwrap -amount both). Sources: CON-01, SPEC-V01, SPEC-V02
- [x] **GL-02** Combined solvency: totalSupply <= underlying.balanceOf(vault) + ptToken.balanceOf(vault). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: ovrfloToken fungibility means holders can exit via either path (unwrap or claim); individual checks (wrappedUnderlying <= balance, MTD <= PT balance) are too strict post-maturity when cross-exits are possible. The combined invariant is the real solvency condition. Sources: CON-02, fuzz campaign 2026-07-01
- [x] **GL-03** marketTotalDeposited <= ptToken.balanceOf(vault) at rest. VALID_STATE, SHOULD-HOLD, HIGH. Evidence: I-8 deposit/claim delta pairs, flashLoan atomic, sweep only takes excess. Sources: CON-03
- [x] **GL-04** sum(poolProceeds) <= ovrfloToken.balanceOf(book). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: Pattern B (internal accounting <= external reality). Sources: CON-10. Iteration: 1..nextPoolId-1.
- [x] **GL-05** sum(offer.capacity) <= underlying.balanceOf(book). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: Pattern B. Sources: CON-11. Iteration: 1..nextOfferId-1.
- [-] **GL-06** sum(poolProceeds) == ovrfloToken.balanceOf(book) (strict, harness only). HIGH_LEVEL, EXPLORATORY, MEDIUM. Sources: CON-13. True if no direct transfers to book.
- [-] **GL-07** sum(offer.capacity) == underlying.balanceOf(book) (strict, harness only). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: CON-14. True if no direct transfers to book.
- [x] **GL-08** drawn + repaid <= obligation for every loan. VALID_STATE, SHOULD-HOLD, HIGH. Evidence: all increments capped at outstanding. Sources: CON-07, SPEC-L06, VS-11. Iteration: 1..nextLoanId-1.
- [x] **GL-09** poolProceeds <= totalObligation for every pool. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: derived from GL-08 + SP-25 conservation. Sources: CON-09, SPEC-L07. Iteration: 1..nextPoolId-1.
- [x] **GL-10** loan.obligation == pool.totalObligation for pool loans. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: both set from same variable at creation, never modified. Sources: CON-12. Iteration: 1..nextLoanId-1.
- [x] **GL-60** totalSupply == sum of all known holder balances (actors + vault + book + treasury). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: ERC-20 standard. Sources: SPEC-T01

### Liveness & Solvency

- [-] **GL-55** Pure wrapper can always unwrap (reserve not drained by depositors). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-01. Ghosts: ghost_hasDeposited, ghost_hasWrapped. **RESOLVED**: Non-issue. ovrfloToken fungibility is a design feature that increases exit optionality. Pure wrappers can also claim PT post-maturity, swap on a DEX, or use any exit path. Subsumed by GL-02 (combined solvency). No one is forced into any particular exit path.
- [-] **GL-56** Depositor can always claim PT (MTD not drained by wrap-then-claim). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-02. Ghosts: ghost_hasDeposited. **RESOLVED**: Non-issue (mirror of GL-55). Depositors can also unwrap underlying, swap on a DEX, or use any exit path. Subsumed by GL-02 (combined solvency).
- [x] **GL-57** No free profit: actor total value <= start + legitimate yield. HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-04. Ghosts: ghost_actorStartValue, ghost_totalStreamWithdrawals.
- [x] **GL-59** No orphaned wrap reserve (wrap-then-claim locks underlying). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-25.
- [x] **GL-63** Sum outstanding <= sum remaining face values across all loans. HIGH_LEVEL, EXPLORATORY, LOW. Sources: SPEC-L01. Iteration: 1..nextLoanId-1 with stream lookups.

### Zero-State

- [x] **GL-58** After all withdraw: totalSupply==0, MTD==0, wrappedUnderlying==0. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-07

### State Transitions (one-way flags)

- [x] **GL-11** offer.active never goes false -> true. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-41. Iteration: 1..nextOfferId-1.
- [x] **GL-12** saleListing.active never goes false -> true. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-42. Iteration: 1..nextSaleListingId-1.
- [x] **GL-13** loan.closed never goes true -> false. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-31, ST-43. Iteration: 1..nextLoanId-1.
- [x] **GL-14** pool.active always true for existing pools. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ST-44. Iteration: 1..nextPoolId-1.

### ID Counter Monotonicity

- [x] **GL-15** All 4 ID counters (nextOfferId, nextSaleListingId, nextLoanId, nextPoolId) monotonically non-decreasing. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-01, VT-02, VT-03, VT-04, SPEC-Q02. Ghosts: ghost_lastNextOfferId, ghost_lastNextSaleListingId, ghost_lastNextLoanId, ghost_lastNextPoolId.
- [x] **GL-19** factory.ovrfloCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-08. Trivially true (factory set up once).
- [x] **GL-20** factory.bookCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-09. Trivially true.
- [x] **GL-21** factory.approvedMarketCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-10. Trivially true.

### Accumulator Monotonicity

- [x] **GL-16** loan.drawn never decreases for any loan. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-05. Iteration: 1..nextLoanId-1.
- [x] **GL-17** loan.repaid never decreases for any loan. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-06. Iteration: 1..nextLoanId-1.
- [x] **GL-18** poolReceived[poolId][contributor] never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-07. Iteration: 1..nextPoolId-1, per contributor.

### Slot Existence Invariants

- [x] **GL-22** pool exists iff poolLoanId[poolId] != 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-01. Iteration: 1..nextPoolId-1.
- [x] **GL-23** loan exists iff loanPoolId[loanId] != 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-02. Iteration: 1..nextLoanId-1.
- [x] **GL-24** poolLoanId[poolId]==loanId iff loanPoolId[loanId]==poolId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-03. Iteration: 1..nextPoolId-1.
- [x] **GL-25** offer slot populated iff id < nextOfferId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-04. Iteration: 1..nextOfferId-1.
- [x] **GL-26** loan slot populated iff id < nextLoanId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-05. Iteration: 1..nextLoanId-1.
- [x] **GL-27** pool slot populated iff id < nextPoolId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-06. Iteration: 1..nextPoolId-1.
- [x] **GL-28** listing slot populated iff id < nextSaleListingId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-07. Iteration: 1..nextSaleListingId-1.
- [x] **GL-29** underlyingToOvrflo one-shot (never overwritten). VALID_STATE, SHOULD-HOLD, LOW. Sources: VS-08. Trivially true (factory set up once).
- [x] **GL-30** ovrfloToBook iff bookToOvrflo. VALID_STATE, SHOULD-HOLD, LOW. Sources: VS-09. Trivially true.

### Closed-State & Active-State Invariants

- [x] **GL-31** loan.closed implies drawn+repaid==obligation. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-10, ADV-20. Iteration: 1..nextLoanId-1.
- [x] **GL-32** offer.active iff capacity > 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-12, SPEC-Q03. Iteration: 1..nextOfferId-1.

### Immutability

- [x] **GL-33** loan.obligation immutable after creation. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-13. Iteration: 1..nextLoanId-1.
- [x] **GL-34** loan.streamId immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-14.
- [x] **GL-35** loan.borrower/lender immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-15.
- [x] **GL-36** offer.maker/aprBps immutable. VARIABLE_TRANSITION, EXPLORATORY, MEDIUM. Sources: VS-16.
- [x] **GL-37** listing.feeBps immutable (snapshot at post time). VARIABLE_TRANSITION, EXPLORATORY, MEDIUM. Sources: VS-17.
- [x] **GL-38** pool.totalContributed immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-18.
- [x] **GL-39** pool.totalObligation immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-19.
- [x] **GL-40** poolContributions immutable after creation. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-20.
- [x] **GL-41** series ptToken/expiryCached/feeBps immutable. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: I-9, setSeriesApproved one-shot guard. Sources: ST-11, VS-21
- [x] **GL-42** ptToMarket immutable, reverse of series.ptToken. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: setSeriesApproved one-shot guard. Sources: ST-12, VS-22

### Rounding Direction

- [x] **GL-43** grossPrice always floors (buyer pays less or equal). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: PRBMath.mulDiv floors, NatSpec. Sources: RD-06. Uses random inputs.
- [x] **GL-44** obligation always ceils (lender owed more or equal). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: explicit +1 on remainder, NatSpec. Sources: RD-07. Uses random inputs.
- [x] **GL-45** factor >= WAD always (non-negative accrual). VALID_STATE, SHOULD-HOLD, LOW. Evidence: WAD + non-negative term, NatSpec. Sources: RD-28. Uses random inputs.

### Zero-Input Reverts

- [x] **GL-46** wrap(0) reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require amount > 0. Sources: RD-19. Uses try/catch.
- [x] **GL-47** unwrap(0) reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require amount > 0. Sources: RD-20. Uses try/catch.
- [x] **GL-48** deposit below MIN_PT_AMOUNT reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require >= MIN_PT_AMOUNT. Sources: RD-21. Uses try/catch.
- [x] **GL-49** claim(0) reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require amount > 0. Sources: RD-22. Uses try/catch.
- [x] **GL-50** postOffer(0) reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require capacity > 0. Sources: RD-23. Uses try/catch.

### Pure-Function Monotonicity

- [x] **GL-51** toUser monotonic non-decreasing in ptAmount (fixed rate). VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: mulDiv monotonic. Sources: RD-24. Ghosts: ghost_lastToUser, ghost_lastDepositPtAmount.
- [x] **GL-52** grossPrice monotonic non-decreasing in remaining. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: mulDiv monotonic. Sources: RD-25. Ghosts: ghost_lastGrossPrice, ghost_lastGrossPriceRemaining.
- [x] **GL-53** obligation monotonic non-decreasing in borrowAmount. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: ceil monotonic. Sources: RD-26. Ghosts: ghost_lastObligation, ghost_lastObligationBorrowAmount.
- [x] **GL-54** grossPrice non-increasing in timeToMaturity. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor increases with ttm. Sources: RD-27. Ghosts: ghost_lastGrossPrice, ghost_lastGrossPriceTtm.

### ERC-20 Standard

- [x] **GL-61** Self-transfer doesn't change balance/supply. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: ERC-20 standard. Sources: SPEC-T02. Called after: transfer.
- [x] **GL-62** Zero-amount transfer doesn't change state. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: ERC-20 standard. Sources: SPEC-T03. Called after: transfer.

---

## Specific Properties

### Round-Trip Conservation

- [x] **SP-01** wrap -> unwrap returns exactly same underlying (1:1, no mulDiv). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-01, RT-11, SPEC-V05. Called after: roundTrip_wrapUnwrap.
- [x] **SP-02** unwrap -> wrap returns exactly same ovrfloToken. HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-02, RT-12. Called after: roundTrip_unwrapWrap.
- [x] **SP-03** postOffer -> cancelOffer returns exactly same capacity. HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-03. Called after: roundTrip_postOfferCancel, cancelOffer. Ghosts: ghost_offerFundedCapacity.
- [x] **SP-04** postSaleListing -> cancelSaleListing returns stream unchanged. HIGH_LEVEL, SHOULD-HOLD, MEDIUM. Sources: RT-04. Called after: roundTrip_postListingCancel, cancelSaleListing.
- [x] **SP-05** deposit -> claim cycle conserves value (PT recovered, fee is only loss). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-05. Called after: roundTrip_depositClaim.
- [x] **SP-06** N cycles of wrap -> unwrap do not increase balance (C2 dust extraction). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-06. Called after: roundTrip_wrapUnwrap. NOT merged with single round-trip.
- [x] **SP-25** poolProceeds + sum(poolReceived) == drawn + repaid (exact conservation per pool). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: CON-08. Called after: closeLoan, repayLoan, claimPoolShare.

### Deposit Properties

- [x] **SP-07** deposit conserves: toUser + toStream == ptAmount, toStream > 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-07, RD-10, RD-11, SPEC-V04. Called after: deposit. Ghosts: ghost_lastToUser.
- [x] **SP-11** previewDeposit matches actual deposit (same block, fixed oracle). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-01. Called after: deposit.
- [x] **SP-12** previewStream matches actual deposit split. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-02. Called after: deposit.
- [x] **SP-14** deposit floors toUser; claim is exact 1:1 (intentional asymmetry). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-05. Called after: deposit, claim.
- [x] **SP-16** deposit toUser capped at ptAmount (rate > 1 reverts via toStream>0 guard). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-13. Called after: deposit.
- [x] **SP-17** deposit fee floored (protocol never overcharges). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-14. Called after: deposit. Ghosts: ghost_depositFeePaid.
- [x] **SP-26** marketTotalDeposited increases by exactly ptAmount after deposit. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-01. Called after: deposit.
- [x] **SP-27** wrappedUnderlying unchanged after deposit. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-02. Called after: deposit.
- [x] **SP-28** deposit only succeeds pre-maturity. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-03. Called after: deposit.
- [x] **SP-62** deposit liveness: valid preconditions (approved, >= MIN, pre-maturity, limit ok) -> must succeed. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-03. Called after: deposit.
- [x] **SP-63** toUser non-decreasing in ptAmount for a fixed rate (not share-based pricing). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-05. Called after: deposit. Ghosts: ghost_lastToUser, ghost_lastDepositPtAmount. **REWRITTEN**: Original ratio check (toUser/ptAmount non-decreasing) was a false positive — mulDiv flooring causes ratio variance with input size, not share inflation. Replaced with toUser monotonicity check (gte(toUser, prevToUser) when ptAmount > prevPtAmount).
- [x] **SP-76** Low deposit limit does not brick claims. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-23. Called after: claim.

### Claim Properties

- [x] **SP-29** marketTotalDeposited decreases by exactly amount after claim. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-04. Called after: claim.
- [x] **SP-30** claim only succeeds post-maturity. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-05. Called after: claim.
- [x] **SP-31** wrappedUnderlying unchanged after claim. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-06. Called after: claim.
- [-] **SP-61** paired deposit -> claim: marketTotalDeposited returns to pre-deposit value. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-40. Called after: roundTrip_depositClaim. **REMOVED**: False positive — the round-trip handler cannot isolate from other actors' deposits/claims in the same call sequence, so absolute MTD equality is invalid in a multi-actor fuzzer. MTD conservation per-operation is already verified by SP-26 (deposit +ptAmount) and SP-29 (claim -amount). SP-05 (actor does not gain PT) is retained.

### Wrap/Unwrap Properties

- [x] **SP-32** wrappedUnderlying increases by exactly amount after wrap. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-07. Called after: wrap.
- [x] **SP-33** wrappedUnderlying decreases by exactly amount after unwrap. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-08. Called after: unwrap.
- [x] **SP-34** marketTotalDeposited unchanged after wrap. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-09. Called after: wrap.
- [x] **SP-35** marketTotalDeposited unchanged after unwrap. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-10. Called after: unwrap.

### Flash Loan Properties

- [x] **SP-08** flash loan atomically repaid, vault never loses PT. VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-08, SPEC-V06. Called after: flashLoan.
- [x] **SP-18** flash loan fee double-floored (two nested mulDiv). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-15. Called after: flashLoan. Ghosts: ghost_flashFeePaid.
- [x] **SP-36** flashLoan: marketTotalDeposited unchanged. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-13, ADV-18. Called after: flashLoan.
- [x] **SP-37** flash loan only succeeds pre-maturity. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-14. Called after: flashLoan.
- [x] **SP-38** flashLoan: wrappedUnderlying unchanged. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-15. Called after: flashLoan.
- [x] **SP-64** flash loan borrower net value <= before (no free profit from flash). VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-06. Called after: flashLoan.

### Admin/Secondary Properties

- [x] **SP-39** sweepExcessPt: marketTotalDeposited unchanged. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-16. Called after: sweepExcessPt.
- [x] **SP-40** sweepExcessUnderlying: wrappedUnderlying unchanged. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-17. Called after: sweepExcessUnderlying.
- [x] **SP-77** sweepExcessPt reverts for non-PT token (pattern #13 input validation guard). VALID_STATE, SHOULD-HOLD, HIGH. Sources: PATTERN-13. Called after: sweepExcessPt.
- [x] **SP-41** setFlashFeeBps: flashFeeBps equals arg and <= FLASH_FEE_MAX_BPS. STATE_TRANSITION, SHOULD-HOLD, LOW. Sources: ST-18. Called after: setFlashFeeBps.
- [x] **SP-42** setFlashLoanPaused: flashLoanPaused equals arg. STATE_TRANSITION, SHOULD-HOLD, LOW. Sources: ST-19. Called after: setFlashLoanPaused.

### Offer Properties

- [x] **SP-43** postOffer: nextOfferId increments by exactly 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-20. Called after: postOffer.
- [x] **SP-44** postOffer: new offer active, capacity > 0, maker == sender. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-21. Called after: postOffer.
- [x] **SP-45** cancelOffer: offer inactive, capacity == 0. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-22. Called after: cancelOffer.
- [x] **SP-46** sellIntoOffer: capacity decreases by grossPrice, active=false only when capacity==0. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-23. Called after: sellIntoOffer.
- [x] **SP-71** Non-maker cannot cancel offer or listing. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-15. Called after: cancelOffer, cancelSaleListing.
- [-] **SP-75** Offer consumed correctly: sale or loan path, value to maker. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-22. Called after: sellIntoOffer, createBorrowPool.

### Sale Listing Properties

- [x] **SP-47** postSaleListing: nextSaleListingId increments by exactly 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-24. Called after: postSaleListing.
- [x] **SP-48** postSaleListing: listing active, feeBps snapshotted from current book.feeBps. STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Sources: ST-25. Called after: postSaleListing.
- [x] **SP-49** cancelSaleListing: listing inactive. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-26. Called after: cancelSaleListing.
- [x] **SP-50** buyListing: listing inactive. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-27. Called after: buyListing.
- [x] **SP-19** book fee floored (StreamPricing.fee uses mulDiv floor). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-16. Called after: sellIntoOffer, buyListing, createBorrowPool. Ghosts: ghost_bookFeePaid.

### Borrow Pool / Loan Creation Properties

- [x] **SP-09** borrow -> repay: obligation >= actualBorrow (factor >= WAD, obligation ceils). VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-09. Called after: createBorrowPool. Ghosts: ghost_borrowReceived.
- [x] **SP-10** obligation <= remaining in partial-borrow path (stream covers debt). VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-10, RD-08. Called after: createBorrowPool. Ghosts: ghost_streamRemainingBeforeBorrow.
- [x] **SP-13** quote matches actual createBorrowPool obligation. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-03. Called after: createBorrowPool.
- [x] **SP-15** full-borrow fast-path (borrowAmount == grossPrice) returns remaining exactly. VALID_STATE, SHOULD-HOLD, HIGH. Sources: RD-09. Called after: createBorrowPool.
- [x] **SP-22** sum(poolContributions) == pool.totalContributed after createBorrowPool. VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-04, SPEC-L05. Called after: createBorrowPool.
- [x] **SP-23** sum(poolReceived) <= pool.totalObligation. VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-05, ADV-19. Called after: claimPoolShare.
- [x] **SP-24** poolReceived[poolId][contributor] <= entitlement (contribution * totalObligation / totalContributed). VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-06, ADV-12, ADV-19. Called after: claimPoolShare.
- [x] **SP-51** createBorrowPool: nextPoolId and nextLoanId each increment by 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-28. Called after: createBorrowPool.
- [x] **SP-52** createBorrowPool: pool active, loan closed=false, drawn=0, repaid=0. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-29. Called after: createBorrowPool.
- [x] **SP-53** createBorrowPool: poolContributions set for consumed offer makers. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-30. Called after: createBorrowPool.
- [-] **SP-66** Dust contributor not bricked by truncation (entitlement > 0 when contribution > 0). VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-09. Called after: createBorrowPool, claimPoolShare.
- [-] **SP-67** No uint128 overflow in pool accounting (_toUint128 reverts on overflow). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-10. Called after: createBorrowPool.
- [x] **SP-77** No self-match bypass (borrower not contributor to own pool). VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-24. Called after: createBorrowPool.
- [x] **SP-78** No loan on zero-remaining stream (requireEligible reverts). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: SPEC-L02. Called after: createBorrowPool.
- [x] **SP-79** borrowAmount <= grossPrice (LTV check enforced). VALID_STATE, SHOULD-HOLD, HIGH. Sources: SPEC-L04. Called after: createBorrowPool.
- [x] **SP-80** Offer IDs strictly increasing, sorted input required (pattern #11). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: SPEC-Q01. Called after: createBorrowPool.

### Loan Servicing Properties

- [x] **SP-21** repayLoan equality check exact (no rounding brick, exact integer wei). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-18. Called after: repayLoan.
- [x] **SP-54** closeLoan: drawn += outstanding, poolProceeds += outstanding (if > 0). STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-32, SPEC-L03. Called after: closeLoan.
- [x] **SP-55** closeLoan with outstanding==0: drawn and poolProceeds unchanged. STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Sources: ST-33. Called after: closeLoan.
- [x] **SP-56** repayLoan: repaid += amount, poolProceeds += amount. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-34. Called after: repayLoan. Ghosts: ghost_repayPaid.
- [x] **SP-57** repayLoan: closed=true iff amount==outstanding; partial repay stays closed=false. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-35, ST-36. Called after: repayLoan.
- [x] **SP-60** claimPoolShare: poolReceived += amount, poolProceeds -= amount. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-39. Called after: claimPoolShare.
- [x] **SP-72** Non-borrower cannot repayLoan. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-16. Called after: repayLoan.
- [-] **SP-74** closeLoan no grief: poolProceeds sufficient for lender after close. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-21. Called after: closeLoan.

### Pool Claim Properties

- [x] **SP-20** pro-rata entitlement floored (protocol-favorable rounding). VALID_STATE, EXPLORATORY, MEDIUM. Sources: RD-17. Called after: claimPoolShare. Ghosts: ghost_poolEntitlementSum.

### Access Control

- [x] **SP-69** Non-admin cannot call vault admin functions. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-13. Called after: secondary (vault admin).
- [x] **SP-70** Non-owner cannot call book admin functions. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-14. Called after: secondary (book admin).
- [x] **SP-73** Stream owner only: no stream theft via sellIntoOffer/postSaleListing/createBorrowPool. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-17. Called after: sellIntoOffer, postSaleListing, createBorrowPool.

### Edge Cases

- [-] **SP-65** Dust ovrfloToken position has exit path (can unwrap or claim small amounts). VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-08. Called after: wrap, deposit.
- [-] **SP-68** Full-amount operations safe (entire balance in one call). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-11. Called after: all clamped handlers.
