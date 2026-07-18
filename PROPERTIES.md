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
- [x] **GL-04** sum(loanPoolProceeds) <= ovrfloToken.balanceOf(lending). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: Pattern B (internal accounting <= external reality). Sources: CON-10. Iteration: 1..nextLoanId-1.
- [x] **GL-05** sum(liquidity.capacity) <= underlying.balanceOf(lending). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: Pattern B. Sources: CON-11. Iteration: 1..nextLiquidityId-1.
- [-] **GL-06** sum(loanPoolProceeds) == ovrfloToken.balanceOf(lending) (strict, harness only). HIGH_LEVEL, EXPLORATORY, MEDIUM. Sources: CON-13. True if no direct transfers to lending.
- [-] **GL-07** sum(liquidity.capacity) == underlying.balanceOf(lending) (strict, harness only). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: CON-14. True if no direct transfers to lending.
- [x] **GL-08** drawn + repaid <= obligation for every loan. VALID_STATE, SHOULD-HOLD, HIGH. Evidence: all increments capped at outstanding. Sources: CON-07, SPEC-L06, VS-11. Iteration: 1..nextLoanId-1.
- [x] **GL-09** loanPoolProceeds <= loan.obligation for every pool/loan. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: derived from GL-08 + SP-25 conservation. Sources: CON-09, SPEC-L07. Iteration: 1..nextLoanId-1.
- [-] **GL-10** loan.obligation == pool.totalObligation for pool loans. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: both set from same variable at creation, never modified. Sources: CON-12. Iteration: 1..nextLoanId-1. **REMOVED**: refactor collapsed pool/loan into a single ID space; obligation is read from loans(i) directly. Review 2026-07-18.
- [x] **GL-60** totalSupply == sum of all known holder balances (actors + vault + lending + treasury). HIGH_LEVEL, SHOULD-HOLD, HIGH. Evidence: ERC-20 standard. Sources: SPEC-T01

### Liveness & Solvency

- [-] **GL-55** Pure wrapper can always unwrap (reserve not drained by depositors). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-01. Ghosts: ghost_hasDeposited, ghost_hasWrapped. **RESOLVED**: Non-issue. ovrfloToken fungibility is a design feature that increases exit optionality. Pure wrappers can also claim PT post-maturity, swap on a DEX, or use any exit path. Subsumed by GL-02 (combined solvency). No one is forced into any particular exit path.
- [-] **GL-56** Depositor can always claim PT (MTD not drained by wrap-then-claim). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-02. Ghosts: ghost_hasDeposited. **RESOLVED**: Non-issue (mirror of GL-55). Depositors can also unwrap underlying, swap on a DEX, or use any exit path. Subsumed by GL-02 (combined solvency).
- [x] **GL-57** No free profit: actor total value <= start + legitimate yield. HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-04. Ghosts: ghost_actorStartValue, ghost_totalStreamWithdrawals.
- [x] **GL-59** No orphaned wrap reserve (wrap-then-claim locks underlying). HIGH_LEVEL, EXPLORATORY, HIGH. Sources: ADV-25.
- [x] **GL-63** Sum outstanding <= sum remaining face values across all loans. HIGH_LEVEL, EXPLORATORY, LOW. Sources: SPEC-L01. Iteration: 1..nextLoanId-1 with stream lookups.

### Zero-State

- [x] **GL-58** After all withdraw: totalSupply==0, MTD==0, wrappedUnderlying==0. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-07

### State Transitions (one-way flags)

- [-] **GL-11** liquidity.active never goes false -> true. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-41. Iteration: 1..nextLiquidityId-1. **REMOVED**: refactor collapsed the state it asserted. Review 2026-07-18.
- [x] **GL-12** saleListing.active never goes false -> true. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-42. Iteration: 1..nextSaleListingId-1.
- [x] **GL-13** loan.closed never goes true -> false. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-31, ST-43. Iteration: 1..nextLoanId-1.
- [-] **GL-14** pool.active always true for existing pools. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ST-44. Iteration: 1..nextLoanPoolId-1. **REMOVED**: refactor collapsed the state it asserted (no separate pool.active flag). Review 2026-07-18.

### ID Counter Monotonicity

- [x] **GL-15** All 3 ID counters (nextLiquidityId, nextSaleListingId, nextLoanId) monotonically non-decreasing. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-01, VT-02, VT-03, SPEC-Q02. Ghosts: ghost_lastNextLiquidityPositionId, ghost_lastNextSaleListingId, ghost_lastNextLoanId.
- [x] **GL-19** factory.ovrfloCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-08. Trivially true (factory set up once).
- [x] **GL-20** factory.lendingCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-09. Trivially true.
- [x] **GL-21** factory.approvedMarketCount never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Sources: VT-10. Trivially true.

### Accumulator Monotonicity

- [x] **GL-16** loan.drawn never decreases for any loan. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-05. Iteration: 1..nextLoanId-1.
- [x] **GL-17** loan.repaid never decreases for any loan. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-06. Iteration: 1..nextLoanId-1.
- [x] **GL-18** loanPoolReceived[poolId][lender] never decreases. VARIABLE_TRANSITION, SHOULD-HOLD, HIGH. Sources: VT-07. Iteration: 1..nextLoanId-1, per lender.

### Slot Existence Invariants

- [-] **GL-22** pool exists iff loanPoolLoanId[poolId] != 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-01. Iteration: 1..nextLoanPoolId-1. **REMOVED**: refactor collapsed pool/loan into a single ID space. Review 2026-07-18.
- [-] **GL-23** loan exists iff loanToLoanPool[loanId] != 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-02. Iteration: 1..nextLoanId-1. **REMOVED**: refactor collapsed pool/loan into a single ID space. Review 2026-07-18.
- [-] **GL-24** loanPoolLoanId[poolId]==loanId iff loanToLoanPool[loanId]==poolId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-03. Iteration: 1..nextLoanPoolId-1. **REMOVED**: refactor collapsed pool/loan into a single ID space. Review 2026-07-18.
- [x] **GL-25** liquidity slot populated iff id < nextLiquidityId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-04. Iteration: 1..nextLiquidityId-1.
- [x] **GL-26** loan slot populated iff id < nextLoanId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-05. Iteration: 1..nextLoanId-1.
- [x] **GL-27** pool slot populated iff id < nextLoanId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-06. Iteration: 1..nextLoanId-1.
- [x] **GL-28** listing slot populated iff id < nextSaleListingId. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-07. Iteration: 1..nextSaleListingId-1.
- [x] **GL-29** underlyingToOvrflo one-shot (never overwritten). VALID_STATE, SHOULD-HOLD, LOW. Sources: VS-08. Trivially true (factory set up once).
- [x] **GL-30** ovrfloToLending iff lendingToOvrflo. VALID_STATE, SHOULD-HOLD, LOW. Sources: VS-09. Trivially true.

### Closed-State & Active-State Invariants

- [x] **GL-31** loan.closed implies drawn+repaid==obligation. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-10, ADV-20. Iteration: 1..nextLoanId-1.
- [-] **GL-32** liquidity.active iff capacity > 0. VALID_STATE, SHOULD-HOLD, HIGH. Sources: VS-12, SPEC-Q03. Iteration: 1..nextLiquidityId-1. **REMOVED**: refactor collapsed the state it asserted. Review 2026-07-18.

### Immutability

- [x] **GL-33** loan.obligation immutable after creation. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-13. Iteration: 1..nextLoanId-1.
- [x] **GL-34** loan.streamId immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-14.
- [x] **GL-35** loan.borrower immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-15.
- [x] **GL-36** liquidity.lender/aprBps immutable. VARIABLE_TRANSITION, EXPLORATORY, MEDIUM. Sources: VS-16.
- [x] **GL-37** listing.feeBps immutable (snapshot at post time). VARIABLE_TRANSITION, EXPLORATORY, MEDIUM. Sources: VS-17.
- [x] **GL-38** pool.totalContributed immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-18.
- [-] **GL-39** pool.totalObligation immutable. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-19. **REMOVED**: refactor collapsed pool/loan into a single ID space; obligation is read from loans(i) directly. Review 2026-07-18.
- [x] **GL-40** loanPoolContributions immutable after creation. VARIABLE_TRANSITION, EXPLORATORY, HIGH. Sources: VS-20.
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
- [x] **GL-50** supplyLiquidity(0) reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require capacity > 0. Sources: RD-23. Uses try/catch.

### Pure-Function Monotonicity

- [x] **GL-51** toUser monotonic non-decreasing in ptAmount (fixed rate). VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: mulDiv monotonic. Sources: RD-24. Ghosts: ghost_lastToUser, ghost_lastDepositPtAmount.
- [x] **GL-52** grossPrice monotonic non-decreasing in remaining. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: mulDiv monotonic. Sources: RD-25. Ghosts: ghost_lastGrossPrice, ghost_lastGrossPriceRemaining.
- [x] **GL-53** obligation monotonic non-decreasing in borrowAmount. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: ceil monotonic. Sources: RD-26. Ghosts: ghost_lastObligation, ghost_lastObligationBorrowAmount.
- [x] **GL-54** grossPrice non-increasing in timeToMaturity. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor increases with ttm. Sources: RD-27. Ghosts: ghost_lastGrossPrice, ghost_lastGrossPriceTtm.

### ERC-20 Standard

- [x] **GL-61** Self-transfer doesn't change balance/supply. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: ERC-20 standard. Sources: SPEC-T02. Called after: transfer.
- [x] **GL-62** Zero-amount transfer doesn't change state. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: ERC-20 standard. Sources: SPEC-T03. Called after: transfer.

### Per-Entity Conservation (Wave 2)

- [x] **GL-64** Per-loan outstanding <= stream remaining (per-entity conservation; GL-63 only checks the sum). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: each loan's outstanding must be backed by its pledged stream's remaining face value; GL-63 is the aggregate and can mask a single over-obligated loan. Sources: CON-01. Iteration: 1..nextLoanId-1 with stream lookups.
- [x] **GL-65** availableLiquidity never increases after creation (one-way capacity). VARIABLE_TRANSITION, SHOULD-HOLD, MEDIUM. Evidence: capacity only decreases via sellStreamToLiquidity/createBorrowerLoanPool consumption and is set once at supplyLiquidity; withdrawLiquidity zeros it. Sources: CON-02, VT-01. Ghosts: ghost_liquidityCapacitySnapshot, ghost_liquidityCapacitySeen. Iteration: 1..nextLiquidityId-1.
- [x] **GL-66** Open loan stream escrowed at lending market (stream.ownerOf == address(lending)). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: createBorrowerLoanPool transfers the pledged stream to the lending contract; closeLoan/full-repayLoan returns it to the borrower. Sources: CON-04, VS-01, SPEC-06. Iteration: 1..nextLoanId-1, only non-closed loans.
- [x] **GL-67** Active listing stream escrowed at lending market. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: postSaleListing transfers the stream to lending; buyListing transfers to buyer, cancelSaleListing returns to seller. Sources: CON-03, VS-02. Iteration: 1..nextSaleListingId-1, only active listings.
- [-] **GL-68** Pool loan lender == address(lending) (loan held by market, not individual). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: createBorrowerLoanPool stores the lending address as loan.lender so the market services the pool claim channel. Sources: CON-05. Iteration: 1..nextLoanId-1 for pool loans. **REMOVED**: refactor collapsed the state it asserted. Review 2026-07-18.
- [x] **GL-69** pool.borrower == loan.borrower (pool and loan share the same borrower). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: both set from msg.sender in createBorrowerLoanPool; never modified. Sources: CON-06. Iteration: 1..nextLoanId-1.
- [x] **GL-70** loan.drawn == stream withdrawals since creation (no external drain). VARIABLE_TRANSITION, EXPLORATORY, MEDIUM. Evidence: closeLoan/_claimFair draw from the stream and increment loan.drawn; an external withdrawal would break the equality. Exploratory because MockSablier permits direct withdrawals in the harness. Sources: CON-07. Ghosts: ghost_loanStreamWithdrawnAtCreation. Iteration: 1..nextLoanId-1. **FIXED**: guard changed from `snapshot == 0 && drawn == 0` to `currentWithdrawn == snapshot && drawn == 0` so fresh-stream external drain fails instead of being skipped. Review 2026-07-18.
- [x] **GL-71** contributions <= consumed capacity (no over-contribution). VALID_STATE, EXPLORATORY, LOW. Evidence: a liquidity can only be consumed up to its capacity; contributions should never exceed the capacity snapshot at pool creation. Exploratory because partial consumption and rounding make the bound soft. Sources: CON-08. Ghosts: ghost_liquidityInitialCapacity. Iteration: 1..nextLoanId-1, per contributor.
- [x] **GL-72** loan.drawn <= stream withdrawn amount (drawn never exceeds what was actually pulled). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: drawn accumulates only via _claimFair which withdraws from the stream first; drawn cannot exceed total withdrawn since creation. Sources: VS-03. Iteration: 1..nextLoanId-1.

### All-Pool Generalizations (Wave 2)

- [x] **GL-73** All pools: sum(loanPoolContributions) == pool.totalContributed (generalizes SP-22 to every pool at rest). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: SP-22 checks the just-created pool; this checks every pool after every call. Sources: SPEC-07. Iteration: 1..nextLoanId-1, per actor.
- [x] **GL-74** All pools: loanPoolProceeds + sum(loanPoolReceived) == drawn + repaid (generalizes SP-25 to every pool at rest). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: SP-25 checks the just-claimed pool; this checks every pool after every call. Sources: SPEC-08, ADV-08. Iteration: 1..nextLoanId-1.
- [x] **GL-75** All pools: loanPoolReceived[poolId][lender] <= entitlement (generalizes SP-24 to every pool at rest). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: pro-rata cap (pattern #12) enforced per claim; this checks it holds across all pools at rest. Sources: SPEC-09. Iteration: 1..nextLoanId-1, per actor.
- [x] **GL-76** All pools: sum(loanPoolReceived) <= loan.obligation (generalizes SP-23 to every pool at rest). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: SP-23 checks the just-claimed pool; this checks every pool after every call. Sources: SPEC-10. Iteration: 1..nextLoanId-1.

### Admin Config Validity (Wave 2)

- [x] **GL-77** APR bounds well-formed: aprMinBps <= aprMaxBps and both within APR_STEP_BPS multiples. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: setLendingAprBounds validates min <= max; bounds persist. Sources: VT-02, SPEC-12. Single read of lending.aprMinBps/aprMaxBps.
- [x] **GL-78** Lending fee bounded: feeBps <= MAX_FEE_BPS. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: setLendingFee validates <= MAX_FEE_BPS. Sources: VT-03, SPEC-13. Single read of lending.feeBps.
- [x] **GL-79** Lending treasury non-zero. VALID_STATE, SHOULD-HOLD, LOW. Evidence: setLendingTreasury rejects address(0). Sources: VT-04, SPEC-14. Single read of lending.treasury.

### Donation Resistance (Wave 2)

- [x] **GL-80** Direct ovrfloToken donation to lending does not inflate claimable pool proceeds. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: loanPoolProceeds is an internal mapping, not a balance read; direct ovrfloToken transfer to lending cannot increase any lender's claim. Sources: ADV-04. Distinct from GL-04 (balance bound). **Covered by fizz_donate handler (F3, review 2026-07-18)**.
- [x] **GL-81** Direct underlying donation to lending does not inflate liquidity capacity. VALID_STATE, SHOULD-HOLD, LOW. Evidence: liquidityPositions[].availableLiquidity is internal, not derived from balance; direct underlying transfer cannot increase any maker's capacity. Sources: ADV-05. Distinct from GL-05 (balance bound). **Covered by fizz_donate handler (F3, review 2026-07-18)**.

### Token & Identity Invariants (Wave 2)

- [x] **GL-82** Non-owner cannot mint/burn ovrfloToken (only vault can). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: OVRFLOToken mint/burn restricted to owner (the vault). Sources: SPEC-03.
- [-] **GL-83** Lending identity matches vault: factory.lendingToOvrflo(lending) == vault and factory.ovrfloToLending(vault) == lending. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: deployLending sets the pair; immutable. Sources: SPEC-04. **REMOVED**: duplicate of GL-30. Review 2026-07-18.
- [x] **GL-84** Open loan stream eligibility persists (requireEligible still passes for an open loan's stream). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: an open loan's stream must remain eligible for the market so closeLoan/_claimFair can draw it. Sources: SPEC-05. Iteration: 1..nextLoanId-1, non-closed loans.
- [-] **GL-85** Direct PT transfer to vault does not inflate marketTotalDeposited. VALID_STATE, EXPLORATORY, LOW. Evidence: MTD is an internal mapping, not balance-derived; direct PT transfer cannot increase MTD. Sources: SPEC-01. Distinct from GL-03 (balance bound). **REMOVED**: duplicate of GL-03. Review 2026-07-18.
- [x] **GL-86** Direct underlying transfer to vault does not inflate wrappedUnderlying. VALID_STATE, EXPLORATORY, LOW. Evidence: wrappedUnderlying is an internal mapping, not balance-derived; direct underlying transfer cannot increase it. Sources: SPEC-02. Distinct from GL-02/GL-59.

### Oracle Safety (Wave 2)

- [x] **GL-87** Oracle zero rate safety: previewRate/quote do not revert or produce nonsensical output when the oracle rate is zero or near-zero. VALID_STATE, EXPLORATORY, LOW. Evidence: pricing math should degrade gracefully at the rate floor; exploratory because the harness clamps the rate away from zero by default. Sources: ADV-18.

### Pure-Function Monotonicity & Bounds (Wave 2)

- [x] **GL-88** fee <= amount for all feeBps <= MAX_FEE_BPS (fee never exceeds the principal). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: fee = floor(amount * feeBps / BPS) and feeBps <= MAX_FEE_BPS <= BPS, so fee <= amount. Sources: RD-01. Pure function over random inputs.
- [x] **GL-89** grossPrice non-increasing in aprBps (higher APR discounts the stream more). VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor increases with aprBps, so grossPrice = remaining * WAD / factor decreases. Sources: RD-02. Pure function over random inputs.
- [x] **GL-90** obligation non-decreasing in aprBps (higher APR accrues more debt). VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor increases with aprBps, so obligation = borrowAmount * factor / WAD increases. Sources: RD-03. Pure function over random inputs.
- [x] **GL-91** obligation non-decreasing in ttm (longer maturity accrues more debt). VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor increases with ttm. Sources: RD-04. Pure function over random inputs.
- [x] **GL-92** factor non-decreasing in aprBps. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor = WAD + aprBps * ttm / (BPS * YEAR); linear in aprBps. Sources: RD-05. Pure function over random inputs.
- [x] **GL-93** factor non-decreasing in ttm. VARIABLE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factor linear in ttm. Sources: RD-06. Pure function over random inputs.
- [x] **GL-94** obligation <= remaining for all borrowAmount <= grossPrice (pure-function generalization of SP-10). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: SP-10 checks the single instance from a handler; this sweeps borrowAmount in [0, grossPrice] and asserts obligation <= remaining for every value. Sources: RD-11. Pure function over random inputs.

---

## Specific Properties

### Round-Trip Conservation

- [x] **SP-01** wrap -> unwrap returns exactly same underlying (1:1, no mulDiv). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-01, RT-11, SPEC-V05. Called after: roundTrip_wrapUnwrap.
- [x] **SP-02** unwrap -> wrap returns exactly same ovrfloToken. HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-02, RT-12. Called after: roundTrip_unwrapWrap.
- [x] **SP-03** supplyLiquidity -> withdrawLiquidity returns exactly same capacity. HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-03. Called after: roundTrip_supplyLiquidityCancel, withdrawLiquidity. Ghosts: ghost_liquidityFundedCapacity.
- [x] **SP-04** postSaleListing -> cancelSaleListing returns stream unchanged. HIGH_LEVEL, SHOULD-HOLD, MEDIUM. Sources: RT-04. Called after: roundTrip_postListingCancel, cancelSaleListing.
- [x] **SP-05** deposit -> claim cycle conserves value (PT recovered, fee is only loss). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-05. Called after: roundTrip_depositClaim.
- [x] **SP-06** N cycles of wrap -> unwrap do not increase balance (C2 dust extraction). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: RT-06. Called after: roundTrip_wrapUnwrap. IS merged with SP-01 (single wrap→unwrap round-trip).
- [x] **SP-25** loanPoolProceeds + sum(loanPoolReceived) == drawn + repaid (exact conservation per pool). HIGH_LEVEL, SHOULD-HOLD, HIGH. Sources: CON-08. Called after: closeLoan, repayLoan, claimLoanPoolShare.

### Deposit Properties

- [x] **SP-07** deposit conserves: toStream > 0 (eq leg removed as tautological — guaranteed by _computeSplit). VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-07, RD-10, RD-11, SPEC-V04. Called after: deposit. Ghosts: ghost_lastToUser.
- [x] **SP-11** previewDeposit matches actual deposit (same block, fixed oracle). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-01. Called after: deposit.
- [x] **SP-12** previewStream matches actual deposit split. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-02. Called after: deposit.
- [x] **SP-14** deposit floors toUser; claim is exact 1:1 (intentional asymmetry). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-05. Called after: deposit, claim.
- [x] **SP-16** deposit toUser capped at ptAmount (rate > 1 reverts via toStream>0 guard). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-13. Called after: deposit.
- [x] **SP-17** deposit fee floored (observed from actor underlying delta, not recomputed formula). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-14. Called after: deposit. Ghosts: ghost_depositFeePaid.
- [x] **SP-26** marketTotalDeposited increases by exactly ptAmount after deposit. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-01. Called after: deposit.
- [x] **SP-27** wrappedUnderlying unchanged after deposit. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-02. Called after: deposit.
- [x] **SP-28** deposit only succeeds pre-maturity. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-03. Called after: deposit.
- [-] **SP-62** deposit liveness: valid preconditions (approved, >= MIN, pre-maturity, limit ok) -> must succeed. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-03. Called after: deposit. **REMOVED**: vacuous — ptAmount > 0 guaranteed by MIN_PT_AMOUNT check. Review 2026-07-18.
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
- [x] **SP-64** flash loan borrower net value <= before (no free profit from flash). VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-06. Called after: flashLoan. Clamped handler asserts mockFlashBorrower deltas; unclamped handler asserts actor deltas.

### Admin/Secondary Properties

- [x] **SP-39** sweepExcessPt: marketTotalDeposited unchanged. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-16. Called after: sweepExcessPt.
- [x] **SP-40** sweepExcessUnderlying: wrappedUnderlying unchanged. STATE_TRANSITION, EXPLORATORY, MEDIUM. Sources: ST-17. Called after: sweepExcessUnderlying.
- [x] **SP-107** sweepExcessPt reverts for non-PT token (pattern #13 input validation guard). VALID_STATE, SHOULD-HOLD, HIGH. Sources: PATTERN-13. Called after: sweepExcessPt.
- [x] **SP-41** setFlashFeeBps: flashFeeBps equals arg and <= FLASH_FEE_MAX_BPS. STATE_TRANSITION, SHOULD-HOLD, LOW. Sources: ST-18. Called after: setFlashFeeBps.
- [x] **SP-42** setFlashLoanPaused: flashLoanPaused equals arg. STATE_TRANSITION, SHOULD-HOLD, LOW. Sources: ST-19. Called after: setFlashLoanPaused.

### LiquidityPosition Properties

- [x] **SP-43** supplyLiquidity: nextLiquidityId increments by exactly 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-20. Called after: supplyLiquidity.
- [x] **SP-44** supplyLiquidity: new liquidity active, capacity > 0, lender == sender (doubled assert removed). STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-21. Called after: supplyLiquidity.
- [x] **SP-45** withdrawLiquidity: liquidity inactive, capacity == 0 (doubled assert removed). STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-22. Called after: withdrawLiquidity.
- [x] **SP-46** sellStreamToLiquidity: capacity decreases by grossPrice (quote-derived, not capacity delta), active=false only when capacity==0. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-23. Called after: sellStreamToLiquidity.
- [x] **SP-71** Non-lender cannot cancel liquidity or listing. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-15. Called after: withdrawLiquidity, cancelSaleListing.
- [-] **SP-75** LiquidityPosition consumed correctly: sale or loan path, value to lender. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-22. Called after: sellStreamToLiquidity, createBorrowerLoanPool.

### Sale Listing Properties

- [x] **SP-47** postSaleListing: nextSaleListingId increments by exactly 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-24. Called after: postSaleListing.
- [x] **SP-48** postSaleListing: listing active, feeBps snapshotted from current lending.feeBps. STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Sources: ST-25. Called after: postSaleListing.
- [x] **SP-49** cancelSaleListing: listing inactive. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-26. Called after: cancelSaleListing.
- [x] **SP-50** buyListing: listing inactive. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-27. Called after: buyListing.
- [x] **SP-19** lending fee floored (observed from treasury balance delta, not recomputed formula). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-16. Called after: sellStreamToLiquidity, buyListing, createBorrowerLoanPool. Ghosts: ghost_lendingFeePaid.

### Borrow Pool / Loan Creation Properties

- [x] **SP-09** borrow -> repay: obligation >= actualBorrow (factor >= WAD, obligation ceils). VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-09. Called after: createBorrowerLoanPool. Ghosts: ghost_borrowReceived.
- [x] **SP-10** obligation <= remaining in partial-borrow path (stream covers debt). VALID_STATE, SHOULD-HOLD, HIGH. Sources: RT-10, RD-08. Called after: createBorrowerLoanPool. Ghosts: ghost_streamRemainingBeforeBorrow.
- [x] **SP-13** quote matches actual createBorrowerLoanPool obligation. VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-03. Called after: createBorrowerLoanPool.
- [x] **SP-15** full-borrow fast-path (borrowAmount == grossPrice) returns remaining exactly. VALID_STATE, SHOULD-HOLD, HIGH. Sources: RD-09. Called after: createBorrowerLoanPool.
- [x] **SP-22** sum(loanPoolContributions) == pool.totalContributed after createBorrowerLoanPool. VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-04, SPEC-L05. Called after: createBorrowerLoanPool.
- [x] **SP-23** sum(loanPoolReceived) <= loan.obligation. VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-05, ADV-19. Called after: claimLoanPoolShare.
- [x] **SP-24** loanPoolReceived[poolId][lender] <= entitlement (contribution * obligation / totalContributed). VALID_STATE, SHOULD-HOLD, HIGH. Sources: CON-06, ADV-12, ADV-19. Called after: claimLoanPoolShare.
- [-] **SP-51** createBorrowerLoanPool: nextLoanPoolId and nextLoanId each increment by 1. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-28. Called after: createBorrowerLoanPool. **REMOVED**: refactor collapsed pool/loan into a single ID space; only nextLoanId increments. Review 2026-07-18.
- [x] **SP-52** createBorrowerLoanPool: loan closed=false, drawn=0, repaid=0. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-29. Called after: createBorrowerLoanPool.
- [x] **SP-53** createBorrowerLoanPool: loanPoolContributions set for consumed liquidity lenders. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-30. Called after: createBorrowerLoanPool.
- [-] **SP-66** Dust lender not bricked by truncation (entitlement > 0 when contribution > 0). VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-09. Called after: createBorrowerLoanPool, claimLoanPoolShare.
- [-] **SP-67** No uint128 overflow in pool accounting (_toUint128 reverts on overflow). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-10. Called after: createBorrowerLoanPool.
- [x] **SP-77** No self-match bypass (borrower not lender to own pool). VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-24. Called after: createBorrowerLoanPool.
- [x] **SP-78** No loan on zero-remaining stream (requireEligible reverts). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: SPEC-L02. Called after: createBorrowerLoanPool.
- [x] **SP-79** borrowAmount <= grossPrice (LTV check enforced). VALID_STATE, SHOULD-HOLD, HIGH. Sources: SPEC-L04. Called after: createBorrowerLoanPool. **REWRITTEN**: quotes with borrowAmount=0 for independent grossPrice, asserts outside try/catch (was unfalsifiable — violating case reverted and was caught). Review 2026-07-18.
- [x] **SP-80** LiquidityPosition IDs strictly increasing, sorted input required (pattern #11). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: SPEC-Q01. Called after: createBorrowerLoanPool.

### Loan Servicing Properties

- [x] **SP-21** repayLoan equality check exact (no rounding brick, exact integer wei). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: RD-18. Called after: repayLoan.
- [x] **SP-54** closeLoan: drawn += outstanding, loanPoolProceeds += outstanding (if > 0). STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-32, SPEC-L03. Called after: closeLoan.
- [x] **SP-55** closeLoan with outstanding==0: drawn and loanPoolProceeds unchanged. STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Sources: ST-33. Called after: closeLoan.
- [x] **SP-56** repayLoan: repaid += amount, loanPoolProceeds += amount. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-34. Called after: repayLoan. Ghosts: ghost_repayPaid.
- [x] **SP-57** repayLoan: closed=true iff amount==outstanding; partial repay stays closed=false. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-35, ST-36. Called after: repayLoan.
- [x] **SP-60** claimLoanPoolShare: loanPoolReceived += amount, loanPoolProceeds -= amount. STATE_TRANSITION, SHOULD-HOLD, HIGH. Sources: ST-39. Called after: claimLoanPoolShare.
- [x] **SP-72** Non-borrower cannot repayLoan. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-16. Called after: repayLoan.
- [-] **SP-74** closeLoan no grief: loanPoolProceeds sufficient for lender after close. VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-21. Called after: closeLoan.

### Pool Claim Properties

- [x] **SP-20** pro-rata entitlement floored (protocol-favorable rounding). VALID_STATE, EXPLORATORY, MEDIUM. Sources: RD-17. Called after: claimLoanPoolShare. Ghosts: ghost_poolEntitlementSum.

### Access Control

- [x] **SP-69** Non-admin cannot call vault admin functions. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-13. Called after: secondary (vault admin).
- [x] **SP-70** Non-owner cannot call lending admin functions. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-14. Called after: secondary (lending admin).
- [x] **SP-73** Stream owner only: no stream theft via sellStreamToLiquidity/postSaleListing/createBorrowerLoanPool. VALID_STATE, SHOULD-HOLD, HIGH. Sources: ADV-17. Called after: sellStreamToLiquidity, postSaleListing, createBorrowerLoanPool.

### Edge Cases

- [-] **SP-65** Dust ovrfloToken position has exit path (can unwrap or claim small amounts). VALID_STATE, EXPLORATORY, MEDIUM. Sources: ADV-08. Called after: wrap, deposit.
- [-] **SP-68** Full-amount operations safe (entire balance in one call). VALID_STATE, SHOULD-HOLD, MEDIUM. Sources: ADV-11. Called after: all clamped handlers.

### Stream Escrow Transitions (Wave 2)

- [x] **SP-81** closeLoan returns the pledged stream to the borrower. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: closeLoan calls _claimFair for the outstanding then transfers the stream back to loan.borrower. Sources: RT-01, ST-02, ADV-01, SPEC-15. Called after: closeLoan.
- [x] **SP-82** Full repayLoan returns the pledged stream to the borrower. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: repayLoan with amount == outstanding sets closed=true and returns the stream to loan.borrower. Sources: RT-02, ST-03, ADV-02, SPEC-16. Called after: repayLoan (when closed).
- [x] **SP-83** createBorrowerLoanPool escrows the pledged stream to the lending market. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: createBorrowerLoanPool transfers the stream to address(lending). Sources: ST-04. Called after: createBorrowerLoanPool.
- [x] **SP-84** sellStreamToLiquidity transfers the stream to the liquidity lender. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: sellStreamToLiquidity transfers the stream to liquidity.lender. Sources: ST-05. Called after: sellStreamToLiquidity.
- [x] **SP-85** postSaleListing escrows the stream to the lending market. STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Evidence: postSaleListing transfers the stream to address(lending). Sources: ST-06. Called after: postSaleListing.
- [x] **SP-86** buyListing transfers the stream to the buyer. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: buyListing transfers the escrowed stream to msg.sender (the buyer). Sources: ST-07. Called after: buyListing.

### Loan Servicing Transitions (Wave 2)

- [x] **SP-87** closeLoan sets loan.closed = true. STATE_TRANSITION, SHOULD-HOLD, HIGH. Evidence: closeLoan writes closed=true after drawing the outstanding. Sources: ST-01. Called after: closeLoan. Distinct from SP-57 (which covers repayLoan's closed flag).
- [x] **SP-88** closeLoan on an invalid/already-closed loan reverts. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: closeLoan requires !closed and withdrawable >= outstanding; calling on a closed or insufficient-stream loan must revert. Sources: ADV-14. Called after: closeLoan (try/catch for invalid inputs).
- [x] **SP-89** Multi-partial repay eventually closes the loan (sum of partial repays == outstanding -> closed). STATE_TRANSITION, SHOULD-HOLD, MEDIUM. Evidence: repayLoan accumulates repaid until outstanding is met; a sequence of partial repays must close the loan exactly. Sources: ADV-16. Called after: repayLoan.
- [-] **SP-90** Harvest (claimLoanPoolShare/_claimFair) does not block a subsequent closeLoan. VALID_STATE, EXPLORATORY, MEDIUM. Evidence: closeLoan draws the remaining outstanding; prior harvests reduce outstanding but should not prevent the close. Exploratory because the interaction depends on stream vesting timing. Sources: ADV-03. Called after: closeLoan following a claim. **REMOVED**: vacuous — closeLoan always closes. Review 2026-07-18.
- [x] **SP-91** Repledge obligation bounded by residual stream value. VALID_STATE, EXPLORATORY, MEDIUM. Evidence: re-pledging a partially-drawn stream should produce an obligation <= the new remaining. Exploratory because re-pledge requires a fresh stream from a re-deposited position. Sources: ADV-07. Called after: createBorrowerLoanPool on a previously-drawn stream.

### Lending Zero-Input Reverts (Wave 2)

- [x] **SP-92** createBorrowerLoanPool with targetBorrow == 0 reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require targetBorrow > 0 in createBorrowerLoanPool. Sources: RD-07, ADV-13. Called after: createBorrowerLoanPool (try/catch).
- [x] **SP-93** claimLoanPoolShare with amount == 0 reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require amount > 0 in claimLoanPoolShare. Sources: RD-08, ADV-13. Called after: claimLoanPoolShare (try/catch).
- [x] **SP-94** repayLoan with amount == 0 reverts. VALID_STATE, SHOULD-HOLD, LOW. Evidence: require amount > 0 in repayLoan. Sources: RD-09, ADV-13. Called after: repayLoan (try/catch). **FIXED**: removed conflicting vm.prank(borrower) — handler already runs under startPrank(actor) and borrower == actor (SP-72). Review 2026-07-18.

### Quote & Preview Correspondence (Wave 2)

- [x] **SP-95** quote obligation matches pool obligation (first tautological assertion removed — borrowAmount == net + fee by construction). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: quote computes all four from the same factor; the obligation parts must reconcile. Sources: RT-03. Called after: createBorrowerLoanPool (via quote).
- [x] **SP-96** previewRate matches the rate used by the actual deposit (same block). VALID_STATE, SHOULD-HOLD, LOW. Evidence: deposit reads previewRate at execution; previewRate is deterministic within a block. Sources: RT-04. Called after: deposit.

### Pool Claim Bounds (Wave 2)

- [x] **SP-97** loanPoolReceived[poolId][lender] <= pro-rata of actual recovered (drawn + repaid + withdrawable-capped), not just obligation. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: SP-24 caps received at pro-rata of obligation; this tighter bound caps at pro-rata of what was actually recovered. Sources: RD-10. Called after: claimLoanPoolShare. Distinct from SP-24 (obligation vs recovered).
- [x] **SP-98** Non-contributor cannot claim a pool share (claimLoanPoolShare reverts or transfers zero). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: claimLoanPoolShare reads contribution; zero contribution yields zero claimable. Sources: ADV-06. Called after: claimLoanPoolShare. Distinct from SP-71/SP-72 (which cover non-maker withdraw and non-borrower repay).

### Settlement Conservation (Wave 2)

- [x] **SP-99** Sale settlement conservation: grossPrice == netToSeller + fee (buyListing and sellStreamToLiquidity split grossPrice exactly). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: the fee is subtracted from grossPrice and the remainder is credited to the seller; the sum must reconcile. Sources: SPEC-11. Called after: buyListing, sellStreamToLiquidity. Ghosts: ghost_lastGrossPrice, ghost_lastFeeAmount, ghost_lastNetToSeller. Snapshot: treasuryUnderlying.
- [x] **SP-100** Borrow disbursement conservation: actor underlying delta == actualBorrow - fee (net disbursement). VALID_STATE, SHOULD-HOLD, HIGH. Evidence: createBorrowerLoanPool transfers actualBorrow underlying to the borrower and deducts fee to treasury; the actor's underlying balance delta must equal actualBorrow - fee. Sources: SPEC-17. Called after: createBorrowerLoanPool.

### Admin Setter Echo (Wave 2)

- [x] **SP-101** setMarketDepositLimit: the stored limit equals the argument. STATE_TRANSITION, SHOULD-HOLD, LOW. Evidence: factory.setMarketDepositLimit writes the arg verbatim. Sources: VT-05. Called after: setMarketDepositLimit.

### Liveness & Boundary (Wave 2)

- [x] **SP-102** Flash loan at max available PT amount succeeds (no off-by-one in the cap). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: flashLoan caps amount at marketTotalDeposited; borrowing the full vault PT balance must succeed and repay atomically. Sources: ADV-09. Called after: flashLoan.
- [x] **SP-103** deposit near the par-rate boundary (rate ~ 1e18) does not revert or over-credit. VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: toStream > 0 guard and toUser <= ptAmount cap must hold at rate = WAD where rounding could flip the split. Sources: ADV-10. Called after: deposit.
- [x] **SP-104** cancelSaleListing succeeds post-maturity (stream return path still valid). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: cancelSaleListing does not depend on market active state; it returns the escrowed stream regardless of maturity. Sources: ADV-11. Called after: cancelSaleListing.
- [x] **SP-105** withdrawLiquidity succeeds post-maturity (capacity refund path still valid). VALID_STATE, SHOULD-HOLD, MEDIUM. Evidence: withdrawLiquidity does not depend on market active state; it refunds remaining capacity regardless of maturity. Sources: ADV-12. Called after: withdrawLiquidity.
- [x] **SP-106** Stream escrow withdraw ACL: only the lending market (as stream owner) can withdraw from an escrowed stream; a random actor cannot. VALID_STATE, EXPLORATORY, MEDIUM. Evidence: Sablier withdraw is gated by ownerOf; once escrowed, only lending can call withdraw. Exploratory because MockSablier's ACL differs from mainnet Sablier. Sources: ADV-15. Called after: sellStreamToLiquidity, postSaleListing, createBorrowerLoanPool.

### Note on Covered/Superseded Candidate

- ADV-17 (repay no profit cycle) is transitively covered by SP-09 (obligation >= actualBorrow) and GL-57 (no free profit). No new ID assigned; documented for traceability.
