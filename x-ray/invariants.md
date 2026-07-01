# Invariant Map

> OVRFLO | 38 guards | 16 inferred | 3 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(msg.sender == factory)` · `OVRFLO.sol:267` · Ensures only the factory (admin hub) can call vault admin functions — the factory is the single governance entry point.

#### G-2
`require(reserve >= amount)` · `OVRFLO.sol:336` · Prevents unwrap from draining more underlying than the wrap reserve tracks — protects the 1:1 backing invariant.

#### G-3
`require(info.approved)` · `OVRFLO.sol:362` · Blocks deposits into unapproved markets — the factory must have called `addMarket` first.

#### G-4
`require(ptAmount >= MIN_PT_AMOUNT)` · `OVRFLO.sol:363` · Prevents dust deposits that would create uneconomic streams (gas > value).

#### G-5
`require(block.timestamp < info.expiryCached)` · `OVRFLO.sol:364` · Deposits only allowed pre-maturity — after maturity, PT = SY and there is no discount to stream.

#### G-6
`require(currentDeposited + ptAmount <= limit)` · `OVRFLO.sol:370` · Per-market deposit cap — when limit > 0, blocks deposits that would exceed the configured ceiling.

#### G-7
`require(toStream > 0)` · `OVRFLO.sol:386` · Ensures every deposit creates a meaningful stream — rejects deposits where the PT rate equals 1.0 (no discount).

#### G-8
`require(toUser >= minToUser)` · `OVRFLO.sol:388` · Slippage protection on the immediate portion — protects depositors from oracle moving between preview and execution.

#### G-9
`require(market != address(0))` · `OVRFLO.sol:420` · Claim only works for registered PT tokens — prevents claiming against unknown PTs.

#### G-10
`require(block.timestamp >= info.expiryCached)` · `OVRFLO.sol:424` · Claims only allowed post-maturity — the PT must have matured before it can be withdrawn.

#### G-11
`require(currentDeposited >= amount)` · `OVRFLO.sol:427` · Claim bounded by per-market deposit accounting — prevents claiming more PT than was deposited into that market.

#### G-12
`require(!flashLoanPaused)` · `OVRFLO.sol:452` · Circuit breaker for flash loans — the admin can pause all flash loans instantly.

#### G-13
`require(amount <= marketTotalDeposited[market])` · `OVRFLO.sol:456` · Flash loan bounded by deposited PT — cannot loan more PT than is tracked for that market.

#### G-14
`require(ret == FLASH_CALLBACK_SUCCESS)` · `OVRFLO.sol:467` · EIP-3156-inspired callback verification — borrower must return the correct success hash.

#### G-15
`require(ptToMarket[ptToken] != address(0))` · `OVRFLO.sol:285` · Prevents `sweepExcessPt` from draining non-PT tokens (e.g. the wrap reserve) — added after fuzz campaign GL-02 violation.

#### G-16
`require(info.ptToken == address(0))` · `OVRFLO.sol:250` · One-shot latch: a market slot can only be configured once — series config is immutable for the vault's lifetime.

#### G-17
`require(ptToMarket[pt] == address(0))` · `OVRFLO.sol:251` · One-shot latch: a PT token can only be mapped to one market — prevents cross-market accounting confusion.

#### G-18
`require(feeBps <= FLASH_FEE_MAX_BPS)` · `OVRFLO.sol:478` · Bounds the flash loan fee at 1% (100 bps) — admin cannot set a higher fee.

#### G-19
`require(underlyingToOvrflo[underlying] == address(0))` · `OVRFLOFactory.sol:111` · One vault per underlying — prevents duplicate vaults that would break ovrfloToken fungibility.

#### G-20
`require(twapDuration >= MIN_TWAP_DURATION)` · `OVRFLOFactory.sol:194` · TWAP window must be at least 15 minutes — prevents short-window oracle manipulation.

#### G-21
`require(twapDuration <= MAX_TWAP_DURATION)` · `OVRFLOFactory.sol:193` · TWAP window capped at 30 minutes — prevents stale-price windows.

#### G-22
`require(feeBps <= FEE_MAX_BPS)` · `OVRFLOFactory.sol:195` · Deposit fee bounded at 1% (100 bps) — admin cannot set a higher fee.

#### G-23
`require(IStandardizedYield(sy).yieldToken() == info.underlying)` · `OVRFLOFactory.sol:207` · Market's SY yield token must match the vault's underlying — prevents incompatible assets sharing one ovrfloToken.

#### G-24
`require(aprMaxBps_ <= APR_MAX_CEILING)` · `OVRFLOBook.sol:278` · APR bound ceiling at 100% — admin cannot raise it past 100% even with a compromised key.

#### G-25
`require(feeBps_ <= MAX_FEE_BPS)` · `OVRFLOBook.sol:291` · Book fee bounded at 100% — hardcoded ceiling the owner cannot exceed.

#### G-26
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps)` · `OVRFLOBook.sol:919` · Posted APR must fall within the current owner-set bounds — rejected otherwise.

#### G-27
`require(aprBps % APR_STEP_BPS == 0)` · `OVRFLOBook.sol:920` · APR must be a whole number (100 bps granularity) — prevents fractional APR manipulation.

#### G-28
`require(offer.maker != borrower)` · `OVRFLOBook.sol:906` · Self-match prevention — borrower cannot consume their own offer, which would break `repayLoan` balance-delta checks.

#### G-29
`require(offerIds[i] > offerIds[i - 1])` · `OVRFLOBook.sol:900` · Strictly-increasing ID check — prevents duplicate offers being double-counted in pool creation.

#### G-30
`require(grossPrice <= offer.capacity)` · `OVRFLOBook.sol:374` · Sale price bounded by remaining offer capacity — prevents over-spending escrowed liquidity.

#### G-31
`require(actualBorrow <= grossPrice)` · `OVRFLOBook.sol:577` · Borrow amount cannot exceed the stream's discounted value — ensures the stream can cover the debt.

#### G-32
`require(withdrawable >= outstanding)` · `OVRFLOBook.sol:479` · Close-loan requires the stream to have accrued enough to cover the outstanding — prevents closing at a loss.

#### G-33
`require(amount <= outstanding)` · `OVRFLOBook.sol:512` · Repayment capped at outstanding — prevents overpayment that would strand ovrfloToken in the book.

#### G-34
`require(poolContributions[poolId][msg.sender] > 0)` · `OVRFLOBook.sol:617` · Only pool contributors can claim — gates pool claim channels to actual capital providers.

#### G-35
`require(uint256(amount) <= available)` · `OVRFLOBook.sol:671` · Claim capped at pro-rata share of poolProceeds — prevents one contributor from draining the shared pot.

#### G-36
`require(loan.borrower != address(0))` · `OVRFLOBook.sol:960` · View/state functions revert on non-existent IDs — distinguishes dead entries from never-created ones.

#### G-37
`require(value <= type(uint128).max)` · `StreamPricing.sol:159` · Obligation calculation reverts on uint128 overflow — prevents wrapping around to a small debt.

#### G-38
`require(balanceAfter - balanceBefore == amount)` · `OVRFLOBook.sol:942` · Strict balance-delta check on `_pullExact` — catches fee-on-transfer or short-transfer tokens.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> `ovrfloToken.totalSupply() == Σ marketTotalDeposited[market] + wrappedUnderlying`

**Derivation** — Δ-pair: `OVRFLO.sol:371` (`Δ(marketTotalDeposited) = +ptAmount`) ↔ `OVRFLO.sol:395-396` (`Δ(ovrfloToken totalSupply) = +ptAmount` via `mint(toUser) + mint(toStream)`); same pattern for claim (`:428-431`), wrap (`:318+320`), unwrap (`:338-340`). Every mint is paired with exactly one tracker increment; every burn with one decrement.

**If violated** — ovrfloToken would be unbacked, enabling value extraction from depositors or wrappers.

---

#### I-2

`Conservation` · On-chain: **Yes**

> `Σ poolContributions[poolId][contributor] == pools[poolId].totalContributed` for every pool

**Derivation** — Δ-pair: `OVRFLOBook.sol:_consumeOffers` (`Δ(offer.capacity) = -consumed` ↔ `Δ(poolContributions[poolId][maker]) = +consumed`); `totalContributed` is set to `actualBorrow128` at pool creation (`:585`), and `_consumeOffers` distributes exactly `actualBorrow` across contributions.

**If violated** — Pool accounting would be inconsistent, enabling over-claiming or under-claiming by contributors.

---

#### I-3

`Conservation` · On-chain: **Yes**

> `loan.drawn + loan.repaid == poolProceeds[poolId] + Σ directDraws` for every pool loan (proceeds from `closeLoan`/`repayLoan` go to `poolProceeds`; `poolClaimLoan` draws directly to the caller)

**Derivation** — Δ-pair: `OVRFLOBook.sol:488` (`Δ(loan.drawn) = +outstanding` ↔ `Δ(poolProceeds) = +outstanding` in `closeLoan`); `:519` (`Δ(loan.repaid) = +amount` ↔ `Δ(poolProceeds) = +amount` in `repayLoan`); `:633` (`Δ(loan.drawn) = +drawAmount` ↔ `Δ(poolReceived) = +drawAmount` in `poolClaimLoan` — direct draw, NOT to poolProceeds).

**If violated** — Lenders could claim more than their entitlement, or proceeds would be stranded.

---

#### I-4

`Conservation` · On-chain: **Yes**

> `poolReceived[poolId][contributor] <= entitlement` where `entitlement = poolContributions * totalObligation / totalContributed`

**Derivation** — Guard-lift: `OVRFLOBook.sol:627-629` (`require(remaining > 0)` where `remaining = entitlement - poolReceived`) in `poolClaimLoan`; `OVRFLOBook.sol:660-661` (same pattern) in `claimPoolShare`. Both claim channels cap at `remaining`, so `poolReceived` can never exceed `entitlement`.

**If violated** — A contributor could claim more than their pro-rata share, stealing from other contributors.

---

#### I-5

`Bound` · On-chain: **Yes**

> `flashFeeBps ∈ [0, 100]` (FLASH_FEE_MAX_BPS)

**Derivation** — Guard-lift: `OVRFLO.sol:478` (`require(feeBps <= FLASH_FEE_MAX_BPS)`) is the only write site to `flashFeeBps`. No other function writes to this variable.

**If violated** — Flash loan fees could be set to 100%, making flash loans economically exploitative.

---

#### I-6

`Bound` · On-chain: **Yes**

> `aprMaxBps ∈ [0, 10000]` (APR_MAX_CEILING) and `aprMinBps <= aprMaxBps`

**Derivation** — Guard-lift: `OVRFLOBook.sol:278` (`require(aprMaxBps_ <= APR_MAX_CEILING)`) and `:276` (`require(aprMaxBps_ >= aprMinBps_)`) in `setAprBounds` — the only write site for both `aprMinBps` and `aprMaxBps`.

**If violated** — APR bounds could be set to allow extreme discount rates, enabling value extraction from stream sellers.

---

#### I-7

`Bound` · On-chain: **Yes**

> `obligation <= remaining` for all partial borrows (StreamPricing rounding invariant)

**Derivation** — NatSpec: `StreamPricing.sol:7-12` — "Rounding is directional and load-bearing: `grossPrice` floors, `obligation` ceils. This keeps `obligation <= remaining` in the partial-borrow path." Confirmed by structural scan: `obligationForFill` fast-paths full-borrow to `remaining` exactly (`:178`), and `obligation` ceils by 1 wei (`:155-157`), while `grossPrice` floors. The ceiling is always <= remaining because `borrowAmount <= grossPrice <= remaining`.

**If violated** — The pledged stream could not cover the debt, breaking the self-repaying loan model.

---

#### I-8

`StateMachine` · On-chain: **Yes**

> `offer.active` never transitions from false to true (one-way flag)

**Derivation** — Edge: `true@postOffer` → `false@cancelOffer/sellIntoOffer/_consumeOffers`. No function sets `active = true` after creation. `cancelOffer` sets `active = false` (`:345`); `sellIntoOffer` sets `active = false` when capacity hits 0 (`:380`); `_consumeOffers` sets `active = false` when capacity hits 0 (`:932`).

**If violated** — Cancelled or consumed offers could be re-activated, draining escrowed funds.

---

#### I-9

`StateMachine` · On-chain: **Yes**

> `loan.closed` never transitions from false to true and back (one-way flag)

**Derivation** — Edge: `false@_storeLoan` → `true@closeLoan/repayLoan`. No function sets `closed = false` after it is set to `true`. `closeLoan` sets `closed = true` (`:484`); `repayLoan` sets `closed = true` when `amount == outstanding` (`:517`).

**If violated** — Closed loans could be re-opened, allowing double-drawing from already-settled streams.

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

**Derivation** — Edge: `address(0)@initial` → `market@setSeriesApproved:254`. Guard `require(ptToMarket[pt] == address(0))` at `:251` prevents overwriting. No function clears `ptToMarket` entries.

**If violated** — A PT could be re-mapped to a different market, breaking per-market deposit accounting that claims depend on.

---

#### I-12

`Temporal` · On-chain: **Yes**

> Deposits only succeed pre-maturity; claims only succeed post-maturity (mutually exclusive by timestamp)

**Derivation** — Temporal: `OVRFLO.sol:364` (`require(block.timestamp < info.expiryCached)` on deposit) ↔ `OVRFLO.sol:424` (`require(block.timestamp >= info.expiryCached)` on claim). These are complementary temporal gates on the same storage variable `expiryCached`.

**If violated** — Post-maturity deposits would create streams with zero duration (no value); pre-maturity claims would bypass the streaming mechanism.

---

#### I-13

`Conservation` · On-chain: **Yes**

> `ovrfloToken.totalSupply() <= underlying.balanceOf(vault) + Σ ptToken.balanceOf(vault)` (combined solvency)

**Derivation** — Δ-pair: follows from I-1 (`totalSupply == MTD + wrappedUnderlying`) plus the observation that `marketTotalDeposited` tracks PT held and `wrappedUnderlying` tracks underlying held. Every deposit pulls PT in (`:378`); every wrap pulls underlying in (`:320`); claim sends PT out (`:432`); unwrap sends underlying out (`:341`). The combined asset-backing invariant holds because each tracker is backed by its corresponding asset, and cross-exits (wrapper claims PT, depositor unwraps underlying) preserve the sum.

**If violated** — ovrfloToken would be under-backed, meaning not all holders could exit through some path (unwrap, claim, or DEX).

---

#### I-14

`Bound` · On-chain: **Yes**

> `feeBps (book) ∈ [0, 10000]` (MAX_FEE_BPS)

**Derivation** — Guard-lift: `OVRFLOBook.sol:291` (`require(feeBps_ <= MAX_FEE_BPS)`) in `setFee` — the only write site for `feeBps`.

**If violated** — Book fee could exceed 100%, making sales/borrows cost more than the stream's value.

---

#### I-15

`Bound` · On-chain: **Yes**

> `depositFeeBps ∈ [0, 100]` (FEE_MAX_BPS) per market series

**Derivation** — Guard-lift: `OVRFLOFactory.sol:195` (`require(feeBps <= FEE_MAX_BPS)`) in `addMarket` — the only function that writes `SeriesInfo.feeBps` (via `setSeriesApproved`). Series config is immutable after setup (I-11).

**If violated** — Deposit fees could exceed 1%, extracting excessive value from depositors.

---

#### I-16

`StateMachine` · On-chain: **Yes**

> `underlyingToOvrflo[underlying]` is a one-shot latch: one vault per underlying, never overwritten

**Derivation** — Edge: `address(0)@initial` → `ovrflo@deploy:153`. Guard `require(underlyingToOvrflo[underlying] == address(0))` at `configureDeployment:111` prevents duplicate configuration. No function clears the mapping.

**If violated** — Two vaults for the same underlying would mint non-fungible ovrfloTokens, breaking the "cross-market fungibility under one underlying" design.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **Yes**

> The factory's `isMarketApproved[ovrflo][market]` is kept in sync with the vault's `_series[market].approved` — both are set in the same `addMarket` call chain.

**Caller side** — `OVRFLOFactory.sol:209` (`addMarket` calls `OVRFLO(ovrflo).setSeriesApproved(...)`) then `:211` (`isMarketApproved[ovrflo][market] = true`)

**Callee side** — `OVRFLO.sol:248-254` (`setSeriesApproved` sets `info.approved = true` and `ptToMarket[pt] = market`)

**If violated** — The book's `_requireMarketActive` (via `StreamPricing.marketActive`) could accept streams from a market the vault doesn't consider approved, or vice versa.

---

#### X-2

On-chain: **No**

> The factory's `ovrfloInfo[ovrflo]` tuple `(treasury, underlying, ovrfloToken)` matches the vault's immutables `(TREASURY_ADDR, underlying, ovrfloToken)` — assumed by `OVRFLOBook` constructor, never re-validated after deployment.

**Caller side** — `OVRFLOBook.constructor:319-321` reads `IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_)` and trusts the returned `(treasury, underlying, ovrfloToken)` to match the vault's actual immutables.

**Callee side** — `OVRFLOFactory.sol:149-151` (`deploy()` sets `ovrfloInfo[ovrflo] = OvrfloInfo({treasury, underlying, ovrfloToken})`) and `OVRFLO.constructor:235-240` (sets vault immutables from constructor params). Both are set from the same `config` struct in `deploy()`, so they match at deployment. But there is no ongoing validation — if the factory's storage were corrupted, the book would operate on mismatched assumptions.

**If violated** — The book would price streams against the wrong ovrfloToken or send fees to the wrong treasury.

---

#### X-3

On-chain: **Yes**

> `StreamPricing.requireEligible` validates that the Sablier stream's sender is the OVRFLO core vault, the asset is the series' ovrfloToken, and the end time matches the cached expiry.

**Caller side** — `OVRFLOBook.sol:925` (`_requireEligible` calls `StreamPricing.requireEligible(factory, sablier, core, market, streamId)`)

**Callee side** — `StreamPricing.sol:202-224` (checks `getSender == core`, `getAsset == ovrfloToken`, `getEndTime == expiryCached`, no cliff, non-cancelable, `deposited > withdrawn`)

**If violated** — Non-OVRFLO streams or streams with wrong parameters could be pledged, breaking the pricing model that assumes deterministic vesting to maturity.

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

**Follows from** — I-7 (obligation <= remaining) + I-9 (loan.closed is one-way) + G-32 (closeLoan requires withdrawable >= outstanding)

**If violated** — A loan could become unrepayable, stranding the borrower's stream permanently.

---

#### E-3

On-chain: **Yes**

> Pool claim fairness: no contributor can claim more than their pro-rata share of total obligation, across both claim channels combined.

**Follows from** — I-4 (poolReceived <= entitlement) + I-2 (Σ poolContributions == totalContributed) + G-35 (claimPoolShare capped at pro-rata of poolProceeds)

**If violated** — A majority contributor could drain pool proceeds before minority contributors can claim.
