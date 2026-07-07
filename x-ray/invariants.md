# Invariant Map

> OVRFLO | 43 guards | 17 inferred | 1 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(msg.sender == factory)` · `OVRFLO.sol:267` · Ensures only the factory (admin hub) can call vault admin functions.

#### G-2
`require(amount > 0)` · `OVRFLO.sol:318` · Prevents zero-amount wraps that would waste gas without minting tokens.

#### G-3
`require(balanceAfter - balanceBefore == amount)` · `OVRFLO.sol:324` · Strict balance-delta check on wrap — catches fee-on-transfer or short-transfer tokens.

#### G-4
`require(reserve >= amount)` · `OVRFLO.sol:338` · Prevents unwrap from draining more underlying than the wrap reserve tracks.

#### G-5
`require(oldestObservationSatisfied)` · `OVRFLO.sol:349` · Oracle freshness check at runtime — prevents deposits and flash loans from using stale TWAP data.

#### G-6
`require(info.approved)` · `OVRFLO.sol:362` · Blocks deposits into unapproved markets — the factory must have called `addMarket` first.

#### G-7
`require(ptAmount >= MIN_PT_AMOUNT)` · `OVRFLO.sol:363` · Prevents dust deposits that would create uneconomic streams.

#### G-8
`require(block.timestamp < info.expiryCached)` · `OVRFLO.sol:364` · Deposits only allowed pre-maturity — after maturity, PT = SY and there is no discount to stream.

#### G-9
`require(currentDeposited + ptAmount <= limit)` · `OVRFLO.sol:372` · Per-market deposit cap — when limit > 0, blocks deposits exceeding the configured ceiling.

#### G-10
`require(toStream > 0)` · `OVRFLO.sol:357` · Ensures every deposit creates a meaningful stream — rejects deposits where the PT rate equals 1.0 (no discount).

#### G-11
`require(toUser >= minToUser)` · `OVRFLO.sol:390` · Slippage protection on the immediate portion — protects depositors from oracle moving between preview and execution.

#### G-12
`require(market != address(0))` · `OVRFLO.sol:436` · Claim only works for registered PT tokens — prevents claiming against unknown PTs.

#### G-13
`require(block.timestamp >= info.expiryCached)` · `OVRFLO.sol:440` · Claims only allowed post-maturity — the PT must have matured before it can be withdrawn.

#### G-14
`require(currentDeposited >= amount)` · `OVRFLO.sol:444` · Claim bounded by per-market deposit accounting — prevents claiming more PT than was deposited.

#### G-15
`require(!flashLoanPaused)` · `OVRFLO.sol:468` · Circuit breaker for flash loans — the admin can pause all flash loans instantly.

#### G-16
`require(amount <= marketTotalDeposited[market])` · `OVRFLO.sol:471` · Flash loan bounded by deposited PT — cannot loan more PT than is tracked for that market.

#### G-17
`require(ret == FLASH_CALLBACK_SUCCESS)` · `OVRFLO.sol:481` · EIP-3156-inspired callback verification — borrower must return the correct success hash.

#### G-18
`require(ptToMarket[ptToken] != address(0))` · `OVRFLO.sol:285` · Prevents `sweepExcessPt` from draining non-PT tokens (e.g. the wrap reserve).

#### G-19
`require(info.ptToken == address(0))` · `OVRFLO.sol:251` · One-shot latch: a market slot can only be configured once — series config is immutable.

#### G-20
`require(ptToMarket[pt] == address(0))` · `OVRFLO.sol:252` · One-shot latch: a PT token can only be mapped to one market — prevents cross-market accounting confusion.

#### G-21
`require(feeBps <= FLASH_FEE_MAX_BPS)` · `OVRFLO.sol:496` · Bounds the flash loan fee at 1% (100 bps) — admin cannot set a higher fee.

#### G-22
`require(aprMaxBps_ >= aprMinBps_)` · `OVRFLOBook.sol:276` · APR bounds must be non-empty — min must not exceed max.

#### G-23
`require(aprMaxBps_ <= APR_MAX_CEILING)` · `OVRFLOBook.sol:277` · APR bound ceiling at 100% — admin cannot raise it past 100%.

#### G-24
`require(aprMinBps_ % APR_STEP_BPS == 0)` · `OVRFLOBook.sol:278` · APR min must be step-aligned (100 bps grid) — prevents configuring bounds with no valid APR.

#### G-25
`require(aprMaxBps_ % APR_STEP_BPS == 0)` · `OVRFLOBook.sol:279` · APR max must be step-aligned (100 bps grid) — prevents configuring bounds with no valid APR.

#### G-26
`require(feeBps_ <= MAX_FEE_BPS)` · `OVRFLOBook.sol:292` · Book fee bounded at 100% — hardcoded ceiling the owner cannot exceed.

#### G-27
`require(treasury_ != address(0))` · `OVRFLOBook.sol:304` · Prevents setting fee treasury to zero — fees would be irrecoverable.

#### G-28
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps)` · `OVRFLOBook.sol:927` · Posted APR must fall within current owner-set bounds.

#### G-29
`require(aprBps % APR_STEP_BPS == 0)` · `OVRFLOBook.sol:928` · APR must be a whole number (100 bps granularity).

#### G-30
`require(offer.active)` · `OVRFLOBook.sol:344` · Prevents operating on cancelled or fully consumed offers.

#### G-31
`require(offer.maker == msg.sender)` · `OVRFLOBook.sol:345` · Only the offer maker can cancel their own offer.

#### G-32
`require(grossPrice <= offer.capacity)` · `OVRFLOBook.sol:374` · Sale price bounded by remaining offer capacity.

#### G-33
`require(netToSeller >= minNetOut)` · `OVRFLOBook.sol:379` · Slippage protection on net seller proceeds (after fees).

#### G-34
`require(listing.active)` · `OVRFLOBook.sol:423` · Prevents operating on cancelled or purchased listings.

#### G-35
`require(listing.maker == msg.sender)` · `OVRFLOBook.sol:424` · Only the listing maker can cancel their own listing.

#### G-36
`require(grossPrice <= maxPriceIn)` · `OVRFLOBook.sol:448` · Buyer slippage protection on purchase price.

#### G-37
`require(!loan.closed)` · `OVRFLOBook.sol:479` · Prevents operating on already-settled loans.

#### G-38
`require(withdrawable >= outstanding)` · `OVRFLOBook.sol:483` · Close-loan requires the stream to have accrued enough to cover the outstanding.

#### G-39
`require(loan.borrower == msg.sender)` · `OVRFLOBook.sol:509` · Only the borrower can repay their own loan.

#### G-40
`require(amount <= outstanding)` · `OVRFLOBook.sol:514` · Repayment capped at outstanding — prevents overpayment.

#### G-41
`require(actualBorrow <= grossPrice)` · `OVRFLOBook.sol:572` · Borrow amount cannot exceed the stream's discounted value — ensures the stream can cover the debt.

#### G-42
`require(netToBorrower >= minAcceptable)` · `OVRFLOBook.sol:577` · Slippage protection on net borrower proceeds (after fees) — prevents fee changes from silently reducing borrower receipts.

#### G-43
`require(offer.maker != borrower)` · `OVRFLOBook.sol:903` · Self-match prevention — borrower cannot consume their own offer.

#### G-44
`require(offerIds[i] > offerIds[i - 1])` · `OVRFLOBook.sol:898` · Strictly-increasing ID check — prevents duplicate offers in pool creation.

#### G-45
`require(poolContributions[poolId][msg.sender] > 0)` · `OVRFLOBook.sol:620` · Only pool contributors can claim — gates pool claim channels to capital providers.

#### G-46
`require(uint256(amount) <= available)` · `OVRFLOBook.sol:655` · Pool share claim capped at `min(remaining entitlement, poolProceeds)` — prevents over-claiming.

#### G-47
`require(loan.borrower != address(0))` · `OVRFLOBook.sol:963` · View/state functions revert on non-existent loan IDs.

#### G-48
`require(balanceAfter - balanceBefore == amount)` · `OVRFLOBook.sol:942` · Strict balance-delta check on `_pullExact` — catches fee-on-transfer or short-transfer tokens.

#### G-49
`require(underlyingToOvrflo[underlying] == address(0))` · `OVRFLOFactory.sol:111` · One vault per underlying — prevents duplicate vaults that would break ovrfloToken fungibility.

#### G-50
`require(twapDuration >= MIN_TWAP_DURATION)` · `OVRFLOFactory.sol:194` · TWAP window must be at least 15 minutes — prevents short-window oracle manipulation.

#### G-51
`require(twapDuration <= MAX_TWAP_DURATION)` · `OVRFLOFactory.sol:193` · TWAP window capped at 30 minutes — prevents stale-price windows.

#### G-52
`require(feeBps <= FEE_MAX_BPS)` · `OVRFLOFactory.sol:195` · Deposit fee bounded at 1% (100 bps).

#### G-53
`require(!increaseCardinalityRequired)` · `OVRFLOFactory.sol:199` · Oracle cardinality must be sufficient at market onboarding.

#### G-54
`require(oldestObservationSatisfied)` · `OVRFLOFactory.sol:200` · Oracle freshness must be confirmed at market onboarding.

#### G-55
`require(IStandardizedYield(sy).yieldToken() == info.underlying)` · `OVRFLOFactory.sol:206` · Market's SY yield token must match the vault's underlying.

#### G-56
`require(value <= type(uint128).max)` · `StreamPricing.sol:159` · Obligation calculation reverts on uint128 overflow.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> `ovrfloToken.totalSupply() == Σ marketTotalDeposited[market] + wrappedUnderlying`

**Derivation** — Δ-pair: `OVRFLO.sol:371` (`Δ(marketTotalDeposited) = +ptAmount`) ↔ `OVRFLO.sol:395-396` (`Δ(ovrfloToken totalSupply) = +ptAmount` via `mint(toUser) + mint(toStream)`); same pattern for claim (`:445-448`), wrap (`:320+322`), unwrap (`:340-342`).

**If violated** — ovrfloToken would be unbacked, enabling value extraction from depositors or wrappers.

---

#### I-2

`Conservation` · On-chain: **Yes**

> `Σ poolContributions[poolId][contributor] == pools[poolId].totalContributed` for every pool

**Derivation** — Δ-pair: `OVRFLOBook.sol:_consumeOffers` (`Δ(offer.capacity) = -consumed` ↔ `Δ(poolContributions[poolId][maker]) = +consumed`); `totalContributed` is set to `actualBorrow128` at pool creation (`:583`).

**If violated** — Pool accounting would be inconsistent, enabling over-claiming or under-claiming.

---

#### I-3

`Conservation` · On-chain: **Yes**

> `loan.drawn + loan.repaid >= poolProceeds[poolId]` for every pool loan

**Derivation** — Δ-pair: `OVRFLOBook.sol:488` (`Δ(loan.drawn) = +outstanding` ↔ `Δ(poolProceeds) = +outstanding` in `closeLoan`); `:519` (`Δ(loan.repaid) = +amount` ↔ `Δ(poolProceeds) = +amount` in `repayLoan`); `claimPoolShare` via `_claimFair` may harvest deficit from the open loan's stream (`Δ(loan.drawn) = +harvestAmount` ↔ `Δ(poolProceeds) = +harvestAmount`), then the claim payout reduces `poolProceeds` (`Δ(poolProceeds) = -claimAmount`) without changing `loan.drawn` or `loan.repaid`. Since harvest adds to both sides equally and claim reduces only `poolProceeds`, `loan.drawn + loan.repaid >= poolProceeds[poolId]` holds.

**If violated** — Lenders could claim more than their entitlement, or proceeds would be stranded.

---

#### I-4

`Conservation` · On-chain: **Yes**

> `poolReceived[poolId][contributor] <= entitlement` where `entitlement = poolContributions * totalObligation / totalContributed`

**Derivation** — Guard-lift: `OVRFLOBook._remainingEntitlement:910-916` computes `remaining = entitlement - poolReceived` and reverts if `remaining == 0`. `claimPoolShare` calls this before any claim. The pro-rata cap was removed in M-01 fix; `poolReceived` now prevents over-claiming, and `claimPoolShare` caps at `min(remaining, poolProceeds)`.

**If violated** — A contributor could claim more than their pro-rata share, stealing from other contributors.

---

#### I-5

`Bound` · On-chain: **Yes**

> `flashFeeBps ∈ [0, 100]` (FLASH_FEE_MAX_BPS)

**Derivation** — Guard-lift: `OVRFLO.sol:496` (`require(feeBps <= FLASH_FEE_MAX_BPS)`) is the only write site to `flashFeeBps`.

**If violated** — Flash loan fees could be set to 100%, making flash loans economically exploitative.

---

#### I-6

`Bound` · On-chain: **Yes**

> `aprMaxBps ∈ [0, 10000]` (APR_MAX_CEILING), `aprMinBps <= aprMaxBps`, and both are step-aligned (multiples of 100)

**Derivation** — Guard-lift: `OVRFLOBook.sol:276-279` enforces all four conditions in `setAprBounds` — the only write site for both `aprMinBps` and `aprMaxBps`. Step alignment added in L-02 fix.

**If violated** — APR bounds could be set to allow extreme discount rates or contain no valid APR step.

---

#### I-7

`Bound` · On-chain: **Yes**

> `obligation <= remaining` for all partial borrows (StreamPricing rounding invariant)

**Derivation** — NatSpec: `StreamPricing.sol:7-12` — "Rounding is directional and load-bearing: `grossPrice` floors, `obligation` ceils. This keeps `obligation <= remaining` in the partial-borrow path." Confirmed: `obligationForFill` fast-paths full-borrow to `remaining` exactly (`:178`), and `obligation` ceils by 1 wei (`:155-157`).

**If violated** — The pledged stream could not cover the debt, breaking the self-repaying loan model.

---

#### I-8

`StateMachine` · On-chain: **Yes**

> `offer.active` never transitions from false to true (one-way flag)

**Derivation** — Edge: `true@postOffer` → `false@cancelOffer/sellIntoOffer/_consumeOffers`. No function sets `active = true` after creation.

**If violated** — Cancelled or consumed offers could be re-activated, draining escrowed funds.

---

#### I-9

`StateMachine` · On-chain: **Yes**

> `loan.closed` never transitions from false to true and back (one-way flag)

**Derivation** — Edge: `false@_storeLoan` → `true@closeLoan/repayLoan`. No function sets `closed = false` after it is set to `true`.

**If violated** — Closed loans could be re-opened, allowing double-drawing from settled streams.

---

#### I-10

`StateMachine` · On-chain: **Yes**

> `saleListing.active` never transitions from false to true (one-way flag)

**Derivation** — Edge: `true@postSaleListing` → `false@cancelSaleListing/buyListing`. No function sets `active = true` after creation.

**If violated** — Cancelled or purchased listings could be re-activated, double-selling the same stream.

---

#### I-11

`StateMachine` · On-chain: **Yes**

> `ptToMarket[pt]` is a one-shot latch: once set, it is never overwritten

**Derivation** — Edge: `address(0)@initial` → `market@setSeriesApproved:254`. Guard `require(ptToMarket[pt] == address(0))` at `:252` prevents overwriting.

**If violated** — A PT could be re-mapped to a different market, breaking per-market deposit accounting.

---

#### I-12

`Temporal` · On-chain: **Yes**

> Deposits only succeed pre-maturity; claims only succeed post-maturity (mutually exclusive by timestamp)

**Derivation** — Temporal: `OVRFLO.sol:364` (`require(block.timestamp < info.expiryCached)` on deposit) ↔ `OVRFLO.sol:440` (`require(block.timestamp >= info.expiryCached)` on claim).

**If violated** — Post-maturity deposits would create zero-duration streams; pre-maturity claims would bypass streaming.

---

#### I-13

`Conservation` · On-chain: **Yes**

> `ovrfloToken.totalSupply() <= underlying.balanceOf(vault) + Σ ptToken.balanceOf(vault)` (combined solvency)

**Derivation** — Follows from I-1 (`totalSupply == MTD + wrappedUnderlying`) plus the observation that `marketTotalDeposited` tracks PT held and `wrappedUnderlying` tracks underlying held. Every deposit pulls PT in; every wrap pulls underlying in; claim sends PT out; unwrap sends underlying out. Cross-exits (wrapper claims PT, depositor unwraps underlying) preserve the sum.

**If violated** — ovrfloToken would be under-backed, meaning not all holders could exit through some path.

---

#### I-14

`Bound` · On-chain: **Yes**

> `feeBps (book) ∈ [0, 10000]` (MAX_FEE_BPS)

**Derivation** — Guard-lift: `OVRFLOBook.sol:292` (`require(feeBps_ <= MAX_FEE_BPS)`) in `setFee` — the only write site for `feeBps`.

**If violated** — Book fee could exceed 100%, making sales/borrows cost more than the stream's value.

---

#### I-15

`Bound` · On-chain: **Yes**

> `depositFeeBps ∈ [0, 100]` (FEE_MAX_BPS) per market series

**Derivation** — Guard-lift: `OVRFLOFactory.sol:195` (`require(feeBps <= FEE_MAX_BPS)`) in `addMarket` — the only function that writes `SeriesInfo.feeBps`.

**If violated** — Deposit fees could exceed 1%, extracting excessive value from depositors.

---

#### I-16

`StateMachine` · On-chain: **Yes**

> `underlyingToOvrflo[underlying]` is a one-shot latch: one vault per underlying, never overwritten

**Derivation** — Edge: `address(0)@initial` → `ovrflo@deploy:153`. Guard `require(underlyingToOvrflo[underlying] == address(0))` at `configureDeployment:111` prevents duplicates.

**If violated** — Two vaults for the same underlying would mint non-fungible ovrfloTokens.

---

#### I-17

`Temporal` · On-chain: **Yes**

> Oracle freshness (`oldestObservationSatisfied`) is checked at runtime in `deposit` and `flashLoan`, not only at market onboarding

**Derivation** — Guard-lift: `OVRFLO._requireOracleFresh:347-350` calls `IPendleOracle.getOracleState` and checks `oldestObservationSatisfied` before every `getPtToSyRate` read. Called in `deposit:377` and `flashLoan:473`. Added in M-03 fix. Cardinality (`increaseCardinalityRequired`) is intentionally NOT rechecked at runtime — it is an onboarding concern handled by `addMarket`.

**If violated** — Stale TWAP data could skew the deposit split or flash loan fee calculation.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **Yes**

> The factory's `isMarketApproved[ovrflo][market]` is kept in sync with the vault's `_series[market].approved` — both are set in the same `addMarket` call chain.

**Caller side** — `OVRFLOFactory.sol:209` (`addMarket` calls `OVRFLO(ovrflo).setSeriesApproved(...)`) then `:211` (`isMarketApproved[ovrflo][market] = true`)

**Callee side** — `OVRFLO.sol:248-254` (`setSeriesApproved` sets `info.approved = true` and `ptToMarket[pt] = market`)

**If violated** — The book's `_requireMarketActive` could accept streams from a market the vault doesn't consider approved, or vice versa.

---

#### X-2

On-chain: **No**

> The factory's `ovrfloInfo[ovrflo]` tuple `(treasury, underlying, ovrfloToken)` matches the vault's immutables `(TREASURY_ADDR, underlying, ovrfloToken)` — assumed by `OVRFLOBook` constructor, never re-validated after deployment.

**Caller side** — `OVRFLOBook.constructor:319-321` reads `IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_)` and trusts the returned tuple.

**Callee side** — `OVRFLOFactory.sol:149-151` (`deploy()` sets `ovrfloInfo[ovrflo]`) and `OVRFLO.constructor:235-240` (sets vault immutables). Both are set from the same `config` struct in `deploy()`, so they match at deployment. No ongoing validation.

**If violated** — The book would price streams against the wrong ovrfloToken or send fees to the wrong treasury.

---

#### X-3

On-chain: **Yes**

> `StreamPricing.requireEligible` validates that the Sablier stream's sender is the OVRFLO core vault, the asset is the series' ovrfloToken, and the end time matches the cached expiry.

**Caller side** — `OVRFLOBook.sol:925` (`_requireEligible` calls `StreamPricing.requireEligible`)

**Callee side** — `StreamPricing.sol:202-224` (checks `getSender == core`, `getAsset == ovrfloToken`, `getEndTime == expiryCached`, no cliff, non-cancelable, `deposited > withdrawn`)

**If violated** — Non-OVRFLO streams or streams with wrong parameters could be pledged, breaking the pricing model.

---

## 4. Economic Invariants

#### E-1

On-chain: **Yes**

> Net ovrfloToken supply equals net backing: every outstanding ovrfloToken is backed by either PT (claimable post-maturity) or underlying (unwrappable anytime).

**Follows from** — I-1 (totalSupply == MTD + wrappedUnderlying) + I-13 (combined solvency: totalSupply <= underlying.balanceOf + PT.balanceOf)

**If violated** — Holders could not exit through any path, causing a de-peg of ovrfloToken from its underlying value.

---

#### E-2

On-chain: **Yes**

> Self-repaying loan solvency: every loan's obligation can be satisfied by the pledged stream's remaining face value.

**Follows from** — I-7 (obligation <= remaining) + I-9 (loan.closed is one-way) + G-38 (closeLoan requires withdrawable >= outstanding)

**If violated** — A loan could become unrepayable, stranding the borrower's stream permanently.

---

#### E-3

On-chain: **Yes**

> Pool claim fairness: no contributor can claim more than their pro-rata share of total obligation.

**Follows from** — I-4 (poolReceived <= entitlement) + I-2 (Σ poolContributions == totalContributed) + G-46 (claimPoolShare capped at min(remaining, poolProceeds))

**If violated** — A majority contributor could drain pool proceeds before minority contributors can claim.
