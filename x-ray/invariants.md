# Invariant Map

> OVRFLO | 32 guards | 18 inferred (single-contract) | 4 cross-contract | 4 economic | 2 not enforced on-chain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below (`G-N`) are anchor targets from x-ray.md attack surfaces.

#### G-1
`require(msg.sender == factory, "OVRFLO: not admin")` · `OVRFLO.sol:148` · Gates all vault admin functions to the factory, which is itself owned by a timelocked multisig.

#### G-2
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `OVRFLO.sol:238` · Prevents overwriting an existing series config; claims depend on ptToken/expiry staying immutable.

#### G-3
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `OVRFLO.sol:239` · Prevents duplicate PT-to-market mapping, ensuring each PT maps to exactly one market.

#### G-4
`require(info.approved, "OVRFLO: market not approved")` · `OVRFLO.sol:362` · Ensures deposits only happen on multisig-approved markets with valid series config.

#### G-5
`require(ptAmount >= MIN_PT_AMOUNT, "OVRFLO: amount < min PT")` · `OVRFLO.sol:363` · Enforces minimum deposit size (1e6 = 0.001 PT) to prevent dust griefing and rounding edge cases.

#### G-6
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:364` · Prevents post-maturity deposits; only pre-maturity deposits create streams.

#### G-7
`require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `OVRFLO.sol:369` · Per-market deposit cap; only checked when limit > 0 (0 = unlimited).

#### G-8
`require(toStream > 0, "OVRFLO: nothing to stream")` · `OVRFLO.sol:388` · Ensures every deposit creates a Sablier stream; reverts if rate rounds to 1.0 making toStream = 0.

#### G-9
`require(toUser >= minToUser, "OVRFLO: slippage")` · `OVRFLO.sol:389` · User-controlled slippage protection on the immediate ovrfloToken mint.

#### G-10
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `OVRFLO.sol:418` · Ensures claims only happen after PT maturity; enforces the temporal deposit/claim boundary.

#### G-11
`require(currentDeposited >= amount, "OVRFLO: deposit accounting")` · `OVRFLO.sol:422` · Prevents claiming more PT than tracked as deposited for the market.

#### G-12
`require(!flashLoanPaused, "OVRFLO: flash paused")` · `OVRFLO.sol:449` · Admin-controlled circuit breaker for flash loans; does not gate deposits or claims.

#### G-13
`require(amount <= marketTotalDeposited[market], "OVRFLO: exceeds deposited")` · `OVRFLO.sol:452` · Caps flash loan at the total PT deposited for the market, preventing over-lending.

#### G-14
`require(feeBps <= FLASH_FEE_MAX_BPS, "OVRFLO: flash fee too high")` · `OVRFLO.sol:475` · Enforces the 1% flash fee ceiling at the setter; protects depositors from excessive flash fees.

#### G-15
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `OVRFLO.sol:335` · Ensures unwrap is bounded by the wrap reserve, not the raw token balance.

#### G-16
`require(balanceAfter - balanceBefore == amount, "OVRFLO: transfer amount mismatch")` · `OVRFLO.sol:322` · Fee-on-transfer protection on wrap; rejects tokens that don't transfer exact amounts.

#### G-17
`require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds")` · `OVRFLOBook.sol:252` · Ensures APR bounds are well-ordered at the setter.

#### G-18
`require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high")` · `OVRFLOBook.sol:253` · Enforces the 100% APR ceiling; cannot be raised even by the owner.

#### G-19
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high")` · `OVRFLOBook.sol:289` · Enforces the 100% protocol fee ceiling at the setter.

#### G-20
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds")` · `OVRFLOBook.sol:838` · Validates posted APR against current bounds; does not affect existing posts.

#### G-21
`require(aprBps % APR_STEP_BPS == 0, "OVRFLOBook: apr not whole")` · `OVRFLOBook.sol:839` · Enforces whole-number APRs (multiples of 100 bps) on all new posts.

#### G-22
`require(actualBorrow <= grossPrice, "OVRFLOBook: borrow above price")` · `OVRFLOBook.sol:562` · LTV check; ensures borrow principal does not exceed the discounted collateral value.

#### G-23
`require(withdrawable >= outstanding, "OVRFLOBook: loan not closable")` · `OVRFLOBook.sol:478` · Ensures the stream has accrued enough to cover the outstanding obligation before closeLoan draws.

#### G-24
`require(amount <= outstanding, "OVRFLOBook: repay too much")` · `OVRFLOBook.sol:514` · Prevents over-repayment; caps repay at the remaining obligation.

#### G-25
`require(uint256(amount) <= available, "OVRFLOBook: exceeds available")` · `OVRFLOBook.sol:660` · Pro-rata cap on claimPoolShare; prevents draining poolProceeds beyond a contributor's share.

#### G-26
`require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids")` · `OVRFLOBook.sol:807` · Prevents duplicate offer IDs in pool creation; enforces strictly-increasing input.

#### G-27
`require(offer.maker != borrower, "OVRFLOBook: self-match")` · `OVRFLOBook.sol:811` · Prevents a borrower from consuming their own offer in createBorrowPool.

#### G-28
`require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed")` · `OVRFLOFactory.sol:93` · Prevents duplicate vault deployment per underlying asset.

#### G-29
`require(twapDuration >= MIN_TWAP_DURATION && twapDuration <= MAX_TWAP_DURATION, ...)` · `OVRFLOFactory.sol:188` · Enforces 15-30 minute TWAP window bounds for oracle manipulation resistance.

#### G-30
`require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high")` · `OVRFLOFactory.sol:191` · Enforces the 1% deposit fee ceiling at market approval time.

#### G-31
`require(ovrfloToBook[ovrflo] == address(0), "OVRFLOFactory: book exists")` · `OVRFLOFactory.sol:163` · Enforces 1:1 vault-to-book mapping; one book per vault.

#### G-32
`require(value <= type(uint128).max, "StreamPricing: obligation overflow")` · `StreamPricing.sol:109` · Prevents uint128 overflow on obligation calculation; guards against extreme APR/time combinations.

---

## 2. Inferred Invariants (Single-Contract)

Each block below cites one of five extraction methods in its `Derivation` field: Δ-pair, guard-lift + write-sites, state-machine edge, temporal predicate, or NatSpec-stated global property.

#### I-1

`Conservation` · On-chain: **Yes**

> OVRFLOToken.totalSupply() == Σ(marketTotalDeposited[market] for all markets) + wrappedUnderlying

**Derivation** — Δ-pair: `OVRFLO.deposit:380-391` mints `toUser + toStream = ptAmount` (Δ totalSupply = +ptAmount, Δ marketTotalDeposited = +ptAmount). `OVRFLO.claim:428-430` burns `amount` (Δ totalSupply = -amount, Δ marketTotalDeposited = -amount). `OVRFLO.wrap:321-327` mints `amount` (Δ totalSupply = +amount, Δ wrappedUnderlying = +amount). `OVRFLO.unwrap:337-341` burns `amount` (Δ totalSupply = -amount, Δ wrappedUnderlying = -amount). All four paths are exact delta pairs. No other function in scope mints or burns OVRFLOToken.

**If violated** — Protocol insolvency: ovrfloToken holders cannot all redeem for backing PT/underlying.

#### I-2

`Bound` · On-chain: **Yes**

> flashFeeBps ∈ [0, 100] (FLASH_FEE_MAX_BPS)

**Derivation** — guard-lift: `require(feeBps <= FLASH_FEE_MAX_BPS)` at `OVRFLO.sol:475` (setFlashFeeBps). Write sites: `setFlashFeeBps:476` (guarded), constructor (defaults to 0). All write sites enforce the bound.

**If violated** — Flash loan fee exceeds 1%, extracting excess value from flash loan borrowers.

#### I-3

`Bound` · On-chain: **Yes**

> feeBps ∈ [0, 10000] (MAX_FEE_BPS) on OVRFLOBook

**Derivation** — guard-lift: `require(feeBps_ <= MAX_FEE_BPS)` at `OVRFLOBook.sol:289` (setFee). Write sites: `setFee:290` (guarded), constructor (defaults to 0). All write sites enforce the bound.

**If violated** — Protocol fee exceeds 100%, making fills economically impossible or extracting more than the fill amount.

#### I-4

`Bound` · On-chain: **Yes**

> aprMaxBps ∈ [0, 10000] (APR_MAX_CEILING)

**Derivation** — guard-lift: `require(aprMaxBps_ <= APR_MAX_CEILING)` at `OVRFLOBook.sol:253` (setAprBounds). Write sites: `setAprBounds:255` (guarded), constructor (defaults to LAUNCH_APR_BPS = 1000). All write sites enforce the bound.

**If violated** — APR exceeds 100%, allowing obligation to exceed the stream's face value.

#### I-5

`Bound` · On-chain: **Yes**

> aprMinBps <= aprMaxBps

**Derivation** — guard-lift: `require(aprMaxBps_ >= aprMinBps_)` at `OVRFLOBook.sol:252` (setAprBounds). Write sites: `setAprBounds:254-255` (writes both, guarded), constructor (sets both to 1000). All write sites enforce the ordering.

**If violated** — APR bounds become inverted; _validateApr rejects all new posts, freezing the market.

#### I-6

`Bound` · On-chain: **No**

> marketTotalDeposited[market] <= marketDepositLimits[market] (when limit > 0)

**Derivation** — guard-lift: `require(currentDeposited + ptAmount <= limit)` at `OVRFLO.sol:369` (deposit, when limit > 0). Write sites: `deposit:371` (guarded, adds), `claim:428` (subtracts, no check needed), `setMarketDepositLimit:273` (writes limit, NO check against current deposited). The setter can set limit below current marketTotalDeposited, violating the bound.

**If violated** — Deposits exceed the intended cap; the invariant "deposits <= limit" no longer holds after an admin lowers the limit.

#### I-7

`Conservation` · On-chain: **Yes**

> wrappedUnderlying <= IERC20(underlying).balanceOf(address(vault))

**Derivation** — Δ-pair: `OVRFLO.wrap:321-327` increases both wrappedUnderlying and balance by `amount`. `OVRFLO.unwrap:337-341` decreases both by `amount`. `sweepExcessUnderlying:308` only sweeps `balance - wrappedUnderlying` (excess). Direct transfers increase balance without increasing wrappedUnderlying (by design).

**If violated** — Unwrap could fail due to insufficient underlying balance, or excess underlying could be swept that belongs to wrapped holders.

#### I-8

`Conservation` · On-chain: **Yes**

> marketTotalDeposited[market] <= IERC20(ptToken).balanceOf(address(vault)) (at rest, between txs)

**Derivation** — Δ-pair: `OVRFLO.deposit:371` increases both marketTotalDeposited and PT balance by ptAmount. `OVRFLO.claim:428-430` decreases both by amount. `sweepExcessPt:292` only sweeps `balance - marketTotalDeposited` (excess). `flashLoan:461-465` temporarily sends PT out and pulls it back within the same tx (nonReentrant); at rest, balance is restored.

**If violated** — Claims could fail due to insufficient PT balance, or excess PT could be swept that belongs to depositors.

#### I-9

`StateMachine` · On-chain: **Yes**

> Series configuration is one-shot: setSeriesApproved can only be called once per market.

**Derivation** — edge: `address(0)@OVRFLO.sol:238 → concrete@OVRFLO.sol:246`. `require(info.ptToken == address(0))` prevents any subsequent call from changing the config. No reverse path exists.

**If violated** — Series config (ptToken, expiry, fee) could be changed after deposits, breaking claim accounting and stream eligibility.

#### I-10

`StateMachine` · On-chain: **Yes**

> underlyingToOvrflo is one-shot: one vault per underlying asset.

**Derivation** — edge: `address(0)@OVRFLOFactory.sol:93 → concrete@OVRFLOFactory.sol:151`. `require(underlyingToOvrflo[underlying] == address(0))` in configureDeployment prevents duplicates. No reverse path exists.

**If violated** — Two vaults for the same underlying could fragment liquidity and break ovrfloToken fungibility assumptions.

#### I-11

`StateMachine` · On-chain: **Yes**

> loan.closed is one-shot: false → true, no reversal.

**Derivation** — edge: `false@OVRFLOBook._storeLoan:884 → true@OVRFLOBook.closeLoan:480` and `true@OVRFLOBook.repayLoan:519` (when amount == outstanding). Both paths set closed = true; no function sets it back to false. Guard `require(!loan.closed)` at closeLoan:474 and repayLoan:506 prevents operations on closed loans.

**If violated** — A closed loan could be re-operated, allowing double-drawing from the returned stream.

#### I-12

`Temporal` · On-chain: **Yes**

> Deposits only pre-maturity (block.timestamp < expiryCached); claims only post-maturity (block.timestamp >= expiryCached).

**Derivation** — temporal: `require(block.timestamp < info.expiryCached)` at `OVRFLO.sol:364` (deposit) and `require(block.timestamp >= info.expiryCached)` at `OVRFLO.sol:418` (claim). Also enforced in flashLoan:450. The series expiry is cached at setSeriesApproved time and never changes (I-9).

**If violated** — Post-maturity deposits could create streams with zero duration; pre-maturity claims would bypass the streaming mechanism.

#### I-13

`Bound` · On-chain: **Yes**

> obligation <= remaining (for every loan at origination)

**Derivation** — NatSpec: `StreamPricing.sol:7-10` — "This keeps `obligation <= remaining` in the partial-borrow path so the pledged stream can always cover the debt." Structural verification: `grossPrice = floor(remaining * WAD / factor)` (floors). `borrowAmount <= grossPrice` (G-22). `obligation = ceil(borrowAmount * factor / WAD)` (ceils). Since `borrowAmount <= floor(remaining * WAD / factor)`, then `borrowAmount * factor <= remaining * WAD`, so `ceil(borrowAmount * factor / WAD) <= remaining`. Full-borrow path returns `remaining` directly (equal).

**If violated** — A loan's obligation exceeds the stream's face value; the lender cannot be fully repaid from the stream, creating bad debt.

#### I-14

`Conservation` · On-chain: **Yes**

> Σ(poolReceived[poolId][i] for all contributors i) <= pools[poolId].totalObligation

**Derivation** — Δ-pair analysis across two claim channels: `poolClaimLoan:622-630` checks `remaining = entitlement - poolReceived > 0` where `entitlement = contribution * totalObligation / totalContributed`. `claimPoolShare:648-660` checks the same entitlement. Both channels update poolReceived additively. Since each contributor's poolReceived <= their entitlement, and Σ entitlements <= totalObligation (integer division rounds down), the sum holds.

**If violated** — Contributors collectively claim more than the pool's total obligation, extracting value from other pools or the protocol.

#### I-15

`Bound` · On-chain: **Yes**

> poolProceeds[poolId] >= 0 (no underflow in claimPoolShare)

**Derivation** — guard-lift: `require(uint256(amount) <= available)` at `OVRFLOBook.sol:660` where `available = min(remaining, proRataShare)` and `proRataShare = poolProceeds * contribution / totalContributed`. Since `amount <= proRataShare <= poolProceeds`, the subtraction `poolProceeds -= amount` cannot underflow. Write sites: `claimPoolShare:662` (guarded subtraction), `closeLoan:483` (addition), `repayLoan:522` (addition), `poolClaimLoan` (no write to poolProceeds — bypasses it).

**If violated** — poolProceeds underflows (uint128), causing a revert or wrap-around that corrupts pool accounting.

#### I-16

`Ratio` · On-chain: **Yes**

> entitlement = poolContributions[poolId][i] * pools[poolId].totalObligation / pools[poolId].totalContributed

**Derivation** — Ratio used in both `poolClaimLoan:620-621` and `claimPoolShare:648-649`. Both enforce `poolReceived <= entitlement` via the `remaining > 0` check. The ratio is computed fresh each call from current storage values. totalContributed and totalObligation are set at pool creation and never modified.

**If violated** — A contributor could claim more than their pro-rata share of the pool's obligation.

#### I-17

`Bound` · On-chain: **Yes** (for new posts)

> Every posted aprBps is a multiple of APR_STEP_BPS (100 bps)

**Derivation** — guard-lift: `require(aprBps % APR_STEP_BPS == 0)` at `OVRFLOBook.sol:839` (_validateApr). Called from postOffer and postSaleListing. All post functions call _validateApr. Existing posts retain their value and cannot be modified. Write sites: postOffer (guarded), postSaleListing (guarded).

**If violated** — Non-whole-number APRs could cause rounding discrepancies in obligation calculations.

#### I-18

`StateMachine` · On-chain: **Yes**

> Each pool has exactly one loan: poolLoanId[poolId] != 0 iff a loan exists for that pool, and loanPoolId[loanId] == poolId iff poolLoanId[poolId] == loanId.

**Derivation** — edge: `0@createBorrowPool:577 → concrete@createBorrowPool:578-579`. Both `loanPoolId[loanId] = poolId` and `poolLoanId[poolId] = loanId` are written atomically in `createBorrowPool:578-579`. No other function writes to either mapping. `poolClaimLoan` derives `loanId` from `poolLoanId[poolId]` and checks `loanId != 0`. No reverse path exists (no function clears either mapping).

**If violated** — poolClaimLoan could derive a wrong or zero loanId, drawing from the wrong stream or reverting; pool-to-loan accounting would be inconsistent.

---

## 3. Inferred Invariants (Cross-Contract)

Trust assumptions that span contract boundaries. Each block cites both caller-side and callee-side code.

#### X-1

On-chain: **Yes**

> factory.isMarketApproved(core, market) and core.series(market).approved are consistent

**Caller side** — `StreamPricing.sol:152-154` — `marketActive` reads `isMarketApproved` from the factory registry, then reads `series(market).approved` from the core vault. Both must return true for the market to be considered active.

**Callee side** — `OVRFLOFactory.addMarket:213-214` writes `isMarketApproved[ovrflo][market] = true` and calls `OVRFLO.setSeriesApproved` which writes `info.approved = true`. Both writes happen in the same transaction (atomic). No function can set one without the other.

**If violated** — A market could be approved on the factory but not the vault (or vice versa), causing inconsistent gating across OVRFLO and OVRFLOBook.

#### X-2

On-chain: **Yes**

> factory.ovrfloInfo(core) returns the correct treasury, underlying, and ovrfloToken for the vault

**Caller side** — `OVRFLOBook.constructor:258-260` reads `ovrfloInfo(core)` to set the book's treasury, underlying, and ovrfloToken immutables. `StreamPricing.requireEligible:180` reads `ovrfloInfo(core)` to validate the core vault is registered.

**Callee side** — `OVRFLOFactory.deploy:147` writes `ovrfloInfo[ovrflo]` with the deployment config values. These are set once at deployment and never modified (no setter exists for ovrfloInfo).

**If violated** — The book could be wired to the wrong treasury, underlying, or token, causing fees or loans to flow to incorrect addresses.

#### X-3

On-chain: **Yes**

> OVRFLOToken.owner == address(OVRFLO vault) for mint/burn authorization

**Caller side** — `OVRFLO.deposit:405-406` calls `OVRFLOToken.mint(user, toUser)`. `OVRFLO.claim:429` calls `OVRFLOToken.burn(msg.sender, amount)`. Both rely on the vault being the token's owner.

**Callee side** — `OVRFLOFactory.deploy:141` calls `token.transferOwnership(ovrflo)` immediately after deploying the vault. `OVRFLOToken.mint:26` and `burn:30` enforce `onlyOwner`. The owner is set once and never changed (no re-transfer path in the current code).

**If violated** — An unauthorized caller could mint unbacked ovrfloTokens or burn tokens they don't own, breaking I-1 (supply conservation).

#### X-4

On-chain: **No**

> setMarketDepositLimit can set limit below current marketTotalDeposited, violating I-6

**Caller side** — `OVRFLOFactory.setMarketDepositLimit:218` calls `OVRFLO.setMarketDepositLimit(market, limit)` forwarding the multisig's chosen value with no check against current deposited amount.

**Callee side** — `OVRFLO.setMarketDepositLimit:273` writes `marketDepositLimits[market] = limit` with no check that `limit >= marketTotalDeposited[market]`. The deposit guard at `OVRFLO.sol:369` only checks `currentDeposited + ptAmount <= limit` for new deposits, not the existing balance.

**If violated** — The invariant "marketTotalDeposited <= limit" (I-6) is broken. New deposits are correctly blocked, but existing deposits exceed the cap. No downstream logic currently assumes this invariant, but it creates a misleading state.

---

## 4. Economic Invariants

Higher-order properties derived from combinations of §2 and §3 invariants.

#### E-1

On-chain: **Yes**

> Protocol solvency: every ovrfloToken is backed 1:1 by either deposited PT or wrapped underlying

**Follows from** — `I-1` (totalSupply = Σ marketTotalDeposited + wrappedUnderlying) + `I-7` (wrappedUnderlying <= underlying balance) + `I-8` (marketTotalDeposited <= PT balance at rest)

**If violated** — Not all ovrfloToken holders can redeem for backing assets; the protocol is insolvent.

#### E-2

On-chain: **Yes**

> Every loan can be fully repaid from its pledged stream (no bad debt possible)

**Follows from** — `I-13` (obligation <= remaining at origination) + `I-11` (loan.closed is one-shot) + stream determinism (non-cancelable Sablier V2 streams vest linearly to maturity)

**If violated** — A loan's obligation exceeds the stream's face value, creating unliquidatable bad debt (no liquidation mechanism exists by design).

#### E-3

On-chain: **Yes**

> Pool contributors can never claim more than their pro-rata share of total obligation

**Follows from** — `I-14` (Σ poolReceived <= totalObligation) + `I-16` (entitlement = contribution * totalObligation / totalContributed) + `G-25` (pro-rata cap on claimPoolShare)

**If violated** — A contributor extracts more than their share, reducing the pool's proceeds available to other contributors.

#### E-4

On-chain: **Yes**

> Pool proceeds cannot be drained by a single contributor before others can claim

**Follows from** — `I-15` (poolProceeds >= 0, no underflow) + `G-25` (pro-rata cap: available = min(remaining, poolProceeds * contribution / totalContributed)) + fix commit `ca8e248` which added the pro-rata cap

**If violated** — A single contributor drains poolProceeds entirely, leaving nothing for other contributors despite their valid entitlements.
