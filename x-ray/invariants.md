# Invariant Map

> OVRFLO | 43 guards | 18 inferred | 0 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `OVRFLO.sol:270` · Prevents overwriting an existing series — one-shot latch ensuring PT/expiry/fee immutability for the life of outstanding deposits

#### G-2
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `OVRFLO.sol:271` · Prevents duplicate PT-to-market mapping — one-shot latch ensuring each PT maps to exactly one market

#### G-3
`require(info.approved, "OVRFLO: market not approved")` · `OVRFLO.sol:380` · Ensures only factory-approved markets accept deposits — gates the deposit path on the series approval state

#### G-4
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:382` · Blocks deposits after PT maturity — temporal gate ensuring streams always have positive duration

#### G-5
`if (limit > 0) require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `OVRFLO.sol:386` · Enforces per-market deposit cap when a limit is set — prevents unbounded PT accumulation in a single market

#### G-6
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `OVRFLO.sol:441` · Blocks claims before PT maturity — temporal gate ensuring PT redemption only after maturity

#### G-7
`require(currentDeposited >= amount, "OVRFLO: deposit accounting")` · `OVRFLO.sol:443` · Prevents claiming more PT than tracked as deposited — conservation guard on marketTotalDeposited

#### G-8
`require(market != address(0), "OVRFLO: unknown PT")` · `OVRFLO.sol:438` · Ensures claim is for a known PT token — validates ptToMarket mapping exists before burning ovrfloToken

#### G-9
`require(!flashLoanPaused, "OVRFLO: flash paused")` · `OVRFLO.sol:467` · Circuit breaker on flash loans — admin-controlled pause for emergency response

#### G-10
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:469` · Blocks flash loans after maturity — PT is redeemable post-maturity, no need for flash

#### G-11
`require(amount <= marketTotalDeposited[market], "OVRFLO: exceeds deposited")` · `OVRFLO.sol:471` · Caps flash loan at tracked deposits — prevents borrowing more PT than the vault holds

#### G-12
`require(feeBps <= FLASH_FEE_MAX_BPS, "OVRFLO: flash fee too high")` · `OVRFLO.sol:495` · Enforces 1% ceiling on flash loan fees — hardcoded bound on admin-set fee

#### G-13
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `OVRFLO.sol:338` · Ensures unwrap is bounded by the wrap reserve — conservation guard preventing underlying drain beyond wrapped supply

#### G-14
`require(ptToMarket[ptToken] != address(0), "OVRFLO: unknown PT")` · `OVRFLO.sol:286` · Ensures sweep only operates on known PT tokens — prevents draining wrap reserve via non-PT token sweep

#### G-15
`require(excess > 0, "OVRFLO: no excess")` · `OVRFLO.sol:290` · Prevents sweeping when no excess exists — ensures sweep cannot touch tracked deposits or wrap reserve

#### G-16
`require(oldestObservationSatisfied, "OVRFLO: oracle not ready")` · `OVRFLO.sol:353` · Validates oracle has sufficient historical data — prevents deposits/flash loans/preview with stale TWAP

#### G-17
`require(balanceAfter - balanceBefore == amount, "OVRFLO: transfer amount mismatch")` · `OVRFLO.sol:323` · Strict balance-delta check on wrap — detects fee-on-transfer or rebasing underlying tokens

#### G-18
`require(toStream > 0, "OVRFLO: nothing to stream")` · `OVRFLO.sol:356` · Ensures every deposit creates a Sablier stream — prevents zero-stream deposits that would break claim accounting

#### G-19
`require(offer.active, "OVRFLOBook: offer inactive")` · `OVRFLOBook.sol:342` · Only active offers can be cancelled or filled — state machine gate on offer lifecycle

#### G-20
`require(offer.maker == msg.sender, "OVRFLOBook: not offer maker")` · `OVRFLOBook.sol:343` · Only the offer maker can cancel — ownership check preventing third-party cancellation

#### G-21
`require(grossPrice <= offer.capacity, "OVRFLOBook: insufficient capacity")` · `OVRFLOBook.sol:372` · Fill price bounded by remaining capacity — conservation guard on offer funds

#### G-22
`require(listing.active, "OVRFLOBook: listing inactive")` · `OVRFLOBook.sol:421` · Only active listings can be cancelled or bought — state machine gate on listing lifecycle

#### G-23
`require(listing.maker == msg.sender, "OVRFLOBook: not listing maker")` · `OVRFLOBook.sol:422` · Only the listing maker can cancel — ownership check preventing third-party cancellation

#### G-24
`require(!loan.closed, "OVRFLOBook: loan closed")` · `OVRFLOBook.sol:480` · No operations on closed loans — state machine gate ensuring closed loans are terminal

#### G-25
`require(loan.borrower == msg.sender, "OVRFLOBook: not borrower")` · `OVRFLOBook.sol:512` · Only the borrower can repay — ownership check preventing third-party repayment (which would return the stream to the borrower)

#### G-26
`require(amount <= outstanding, "OVRFLOBook: repay too much")` · `OVRFLOBook.sol:515` · Repayment capped at outstanding — prevents overpayment that would lose ovrfloToken without closing the loan

#### G-27
`require(withdrawable >= outstanding, "OVRFLOBook: loan not closable")` · `OVRFLOBook.sol:481` · Close requires sufficient stream accrual — ensures the lender can be made whole from the stream before closing

#### G-28
`require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds")` · `OVRFLOBook.sol:275` · APR bound ordering — prevents setting min > max which would block all new posts

#### G-29
`require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high")` · `OVRFLOBook.sol:276` · Hardcoded 100% APR ceiling — admin cannot raise rates beyond the protocol's design limit

#### G-30
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high")` · `OVRFLOBook.sol:289` · Hardcoded 100% fee ceiling — admin cannot set a fee that would consume the entire fill

#### G-31
`require(offer.maker != borrower, "OVRFLOBook: self-match")` · `OVRFLOBook.sol:849` · Prevents self-match in borrow pools — stops a borrower from consuming their own offer, which would create a loan against themselves

#### G-32
`require(contribution > 0, "OVRFLOBook: not contributor")` · `OVRFLOBook.sol:642` · Only pool contributors can claim — access control on the claim path preventing non-contributors from draining poolProceeds

#### G-33
`require(loan.borrower != address(0), "OVRFLOBook: unknown loan")` · `OVRFLOBook.sol:901` · Loan existence check — prevents operating on uninitialized loan storage slots

#### G-34
`require(payAmount > 0, "OVRFLOBook: nothing claimable")` · `OVRFLOBook.sol:668` · Prevents zero-amount claims — ensures claimPoolShare only emits events when value is transferred

#### G-35
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds")` · `OVRFLOBook.sol:886` · APR range enforcement on all new posts — ensures offers and listings stay within admin-set bounds

#### G-36
`require(aprBps % APR_STEP_BPS == 0, "OVRFLOBook: apr not whole")` · `OVRFLOBook.sol:887` · APR must be a whole number (100 bps steps) — prevents fractional APRs that could cause pricing precision issues

#### G-37
`require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids")` · `OVRFLOBook.sol:847` · Sorted unique offer IDs in pool creation — prevents duplicate offer consumption and ensures deterministic batching

#### G-38
`require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long")` · `OVRFLOFactory.sol:193` · TWAP duration upper bound (30 min) — prevents excessively long windows that would make rates stale

#### G-39
`require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short")` · `OVRFLOFactory.sol:194` · TWAP duration lower bound (15 min) — prevents short windows susceptible to manipulation

#### G-40
`require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high")` · `OVRFLOFactory.sol:195` · Series fee ceiling (1%) — admin cannot set deposit fees above the protocol's design limit

#### G-41
`require(!increaseCardinalityRequired, "OVRFLOFactory: oracle cardinality")` · `OVRFLOFactory.sol:198` · Oracle cardinality sufficient — ensures enough observations exist for the requested TWAP window

#### G-42
`require(oldestObservationSatisfied, "OVRFLOFactory: oracle not ready")` · `OVRFLOFactory.sol:199` · Oracle readiness at market add — ensures TWAP is valid before allowing deposits

#### G-43
`require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed")` · `OVRFLOFactory.sol:84` · Prevents duplicate vault deployment per underlying — ensures 1:1 underlying-to-vault mapping

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> `wrappedUnderlying <= underlying.balanceOf(vault)` — the wrap reserve never exceeds the vault's actual underlying balance.

**Derivation** — Δ-pair: `OVRFLO.sol:319` `wrappedUnderlying += amount` paired with `safeTransferFrom(msg.sender, this, amount)` (underlying in). `OVRFLO.sol:339` `wrappedUnderlying = reserve - amount` paired with `safeTransfer(msg.sender, amount)` (underlying out). `sweepExcessUnderlying` at :300-303 only sweeps `balance - wrappedUnderlying` (excess above reserve).

**If violated** — Unwraps would fail (G-13 catches), or the vault would be insolvent on the underlying leg of the combined solvency invariant (E-1).

---

#### I-2

`Conservation` · On-chain: **Yes**

> `marketTotalDeposited[market] <= ptToken.balanceOf(vault)` for each approved market — tracked deposits never exceed actual PT held.

**Derivation** — Δ-pair: `OVRFLO.sol:388` `marketTotalDeposited[market] += ptAmount` paired with `safeTransferFrom(msg.sender, this, ptAmount)` (PT in). `OVRFLO.sol:444` `marketTotalDeposited[market] -= amount` paired with `safeTransfer(msg.sender, amount)` (PT out on claim). `sweepExcessPt` at :287-290 only sweeps `balance - deposited` (excess above tracked). `flashLoan` at :474-477 sends PT out and pulls it back — no net change to balance or tracking.

**If violated** — Claims could attempt to transfer more PT than the vault holds, causing a revert. Or the vault would be insolvent on the PT leg of E-1.

---

#### I-3

`Conservation` · On-chain: **Yes**

> `Σ poolContributions[poolId][*] == pools[poolId].totalContributed` — the sum of all contributor amounts equals the pool's total contributed capital.

**Derivation** — Δ-pair: `OVRFLOBook.sol:873` `poolContributions[poolId][offer.maker] += consumed` and `OVRFLOBook.sol:569` `pools[poolId].totalContributed = actualBorrow128` — both set from the same loop in `_consumeOffers` where `Σ consumed == actualBorrow`. No other function writes to `totalContributed` after creation.

**If violated** — Pro-rata claims (I-18) would compute incorrect shares, allowing some contributors to over-claim or under-claim.

---

#### I-4

`Conservation` · On-chain: **Yes**

> `loan.drawn + loan.repaid <= loan.obligation` — total recovery never exceeds the obligation.

**Derivation** — Δ-pair analysis across all write sites:
- `closeLoan:486` `loan.drawn += outstanding` where `outstanding = obligation - drawn - repaid`. After: `drawn' + repaid = obligation`.
- `repayLoan:516` `loan.repaid += amount` where `amount <= outstanding` (G-26). After: `drawn + repaid' <= obligation`.
- `_claimFair:663` `loan.drawn += harvestAmount` where `harvestAmount <= min(withdrawable, outstanding)`. After: `drawn' + repaid <= obligation`.

**If violated** — The lender (pool) could extract more ovrfloToken than the stream owes, draining the borrower's residual.

---

#### I-5

`Bound` · On-chain: **Yes**

> `flashFeeBps <= FLASH_FEE_MAX_BPS (100)` — flash loan fee never exceeds 1%.

**Derivation** — Guard-lift: `require(feeBps <= FLASH_FEE_MAX_BPS)` at `OVRFLO.sol:495`. Write sites: `setFlashFeeBps` (guarded, :496). No other function writes `flashFeeBps`. Constructor leaves it at 0 (default).

**If violated** — Flash loan fees could be set to 100%, making flash loans unusable or extracting all borrowed value as fees.

---

#### I-6

`Bound` · On-chain: **Yes**

> `feeBps (OVRFLOBook) <= MAX_FEE_BPS (10_000)` — book protocol fee never exceeds 100%.

**Derivation** — Guard-lift: `require(feeBps_ <= MAX_FEE_BPS)` at `OVRFLOBook.sol:289`. Write sites: `setFee` (guarded, :291). Constructor sets to 0 (default).

**If violated** — Book fees could exceed 100%, causing `netToSeller = grossPrice - fee` to underflow or extract more than the fill amount.

---

#### I-7

`Bound` · On-chain: **Yes**

> `aprMinBps <= aprMaxBps <= APR_MAX_CEILING (10_000)` — APR bounds are ordered and capped at 100%.

**Derivation** — Guard-lift: `require(aprMaxBps_ >= aprMinBps_)` and `require(aprMaxBps_ <= APR_MAX_CEILING)` at `OVRFLOBook.sol:275-276`. Write sites: `setAprBounds` (guarded, :279-280), constructor (:260-261, sets both to `LAUNCH_APR_BPS = 1000` which satisfies the bounds). Step alignment enforced by G-36.

**If violated** — APR bounds could be inverted (blocking all posts) or set above 100%, creating nonsensical pricing.

---

#### I-8

`Bound` · On-chain: **Yes**

> `marketTotalDeposited[market] <= marketDepositLimits[market]` (when limit > 0) — deposits never exceed the per-market cap.

**Derivation** — Guard-lift: `require(currentDeposited + ptAmount <= limit)` at `OVRFLO.sol:386` (only when `limit > 0`). Write sites: `deposit` (guarded, :388, only increases), `claim` (:444, only decreases — cannot violate). `setMarketDepositLimit` writes the limit but doesn't touch `marketTotalDeposited`.

**If violated** — A market could accumulate unbounded PT, concentrating risk in a single series.

---

#### I-9

`Bound` · On-chain: **Yes**

> `SeriesInfo.feeBps <= FEE_MAX_BPS (100)` for all approved series — deposit fee never exceeds 1%.

**Derivation** — Guard-lift: `require(feeBps <= FEE_MAX_BPS)` at `OVRFLOFactory.sol:195`. Write site: `OVRFLO.setSeriesApproved` at :261 (`info.feeBps = feeBps`) — only callable by factory (`onlyAdmin`), which enforces the guard in `addMarket`. No other path writes `SeriesInfo.feeBps`.

**If violated** — Deposit fees could exceed 1%, extracting more underlying than the protocol's design allows.

---

#### I-10

`StateMachine` · On-chain: **Yes**

> `loan.closed` is a one-shot latch: `false → true` with no reverse path.

**Derivation** — Edge: `false` at creation (`_storeLoan:893`) → `true` at `closeLoan:480` or `repayLoan:517`. Guard `require(!loan.closed)` at :480 and :511 prevents any operation on a closed loan. No function sets `loan.closed = false`.

**If violated** — A closed loan could be reopened, allowing double-drawing from a stream that has already been returned to the borrower.

---

#### I-11

`StateMachine` · On-chain: **Yes**

> `SeriesInfo.ptToken` is a one-shot latch: `address(0) → concrete PT address` with no reverse path.

**Derivation** — Edge: `address(0)` at default → `pt` at `setSeriesApproved:270`. Guard `require(info.ptToken == address(0))` at :270 prevents overwrite. No function clears a series.

**If violated** — A series could be reconfigured, changing the PT token or expiry for existing deposits — breaking claim accounting and stream eligibility.

---

#### I-12

`StateMachine` · On-chain: **Yes**

> `ptToMarket[pt]` is a one-shot latch: `address(0) → market` with no reverse path.

**Derivation** — Edge: `address(0)` at default → `market` at `setSeriesApproved:272`. Guard `require(ptToMarket[pt] == address(0))` at :271 prevents remapping. No function clears a PT mapping.

**If violated** — A PT could be remapped to a different market, causing claims to burn ovrfloToken against the wrong PT token.

---

#### I-13

`StateMachine` · On-chain: **Yes**

> `offer.active` transitions `true → false` only (cancel or full consumption). No reverse path.

**Derivation** — Edge: `true` at `postOffer:328` → `false` at `cancelOffer:347` or `sellIntoOffer:377` (when capacity hits 0) or `_consumeOffers:862` (when capacity hits 0). Guards `require(offer.active)` at :342, :363, :560, :845 prevent operations on inactive offers. No function reactivates an offer.

**If violated** — A cancelled or consumed offer could be filled again, double-spending its capacity.

---

#### I-14

`StateMachine` · On-chain: **Yes**

> `listing.active` transitions `true → false` only (cancel or buy). No reverse path.

**Derivation** — Edge: `true` at `postSaleListing:412` → `false` at `cancelSaleListing:424` or `buyListing:450`. Guards `require(listing.active)` at :421, :438 prevent operations on inactive listings. No function reactivates a listing.

**If violated** — A cancelled or sold listing could be bought again, double-selling the same stream.

---

#### I-15

`Temporal` · On-chain: **Yes**

> Deposits only pre-maturity: `block.timestamp < info.expiryCached` for all deposit calls.

**Derivation** — Temporal: `require(block.timestamp < info.expiryCached)` at `OVRFLO.sol:382`. `expiryCached` is set once in `setSeriesApproved` and never updated. No function writes `expiryCached` after initial set.

**If violated** — Post-maturity deposits would create zero-duration streams (broken Sablier creation) and claim against already-redeemable PT.

---

#### I-16

`Temporal` · On-chain: **Yes**

> Claims only post-maturity: `block.timestamp >= info.expiryCached` for all claim calls.

**Derivation** — Temporal: `require(block.timestamp >= info.expiryCached)` at `OVRFLO.sol:441`. Same immutable `expiryCached` as I-15.

**If violated** — Pre-maturity claims would burn ovrfloToken for PT that hasn't matured, losing the streaming yield portion.

---

#### I-17

`Temporal` · On-chain: **Yes**

> Flash loans only pre-maturity: `block.timestamp < info.expiryCached` for all flashLoan calls.

**Derivation** — Temporal: `require(block.timestamp < info.expiryCached)` at `OVRFLO.sol:469`. Same immutable `expiryCached` as I-15.

**If violated** — Post-maturity flash loans would borrow PT that is directly redeemable, creating an unnecessary risk vector.

---

#### I-18

`Ratio` · On-chain: **Yes**

> Pool claimable amount: `claimable = contribution * recovered / totalContributed - poolReceived`, where `recovered = drawn + repaid + min(withdrawable, outstanding)` for open loans and `recovered = drawn + repaid` for closed loans.

**Derivation** — Ratio: `OVRFLOBook.sol:649-651` computes `claimable = uint256(contribution) * recovered / uint256(pools[poolId].totalContributed) - poolReceived[poolId][account]`. The ratio `contribution / totalContributed` determines each contributor's pro-rata share of total recovery. `poolReceived` tracks cumulative prior claims, ensuring no contributor exceeds their share across multiple claims.

**If violated** — A contributor could claim more than their pro-rata share, draining poolProceeds at the expense of other contributors.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **Yes**

> If `OVRFLOFactory.isMarketApproved[ovrflo][market] == true`, then `OVRFLO._series[market].approved == true` — the factory's approval registry is consistent with the vault's series state.

**Caller side** — `StreamPricing.sol:189` — `marketActive()` reads `IOVRFLOFactoryRegistry(factory).isMarketApproved(core, market)` and then `IOVRFLOSeriesRegistry(core).series(market).approved`.

**Callee side** — `OVRFLOFactory.sol:214-217` — `addMarket()` calls `OVRFLO.setSeriesApproved()` (sets `approved = true`) and then sets `isMarketApproved[ovrflo][market] = true` in the same transaction. Both writes are atomic.

**If violated** — The book would operate on a market the vault doesn't consider approved, or vice versa — stream eligibility checks would be inconsistent.

---

#### X-2

On-chain: **Yes**

> `obligation <= remaining` for all loans — the pledged stream's remaining face value always covers the loan obligation.

**Caller side** — `OVRFLOBook.sol:576-578` — `createBorrowPool` calls `StreamPricing.obligationForFill(borrowAmount, grossPrice, remaining, aprBps, ttm)` and stores the result as `loan.obligation`.

**Callee side** — `StreamPricing.sol:161-170` — `obligationForFill` returns `remaining` when `borrowAmount == grossPrice` (full borrow), or `obligation(borrowAmount, aprBps, ttm)` which ceils. The call site enforces `borrowAmount <= grossPrice` at `OVRFLOBook.sol:573`. Since `grossPrice = remaining * WAD / factor` (floored) and `obligation = borrowAmount * factor / WAD` (ceiled), and `borrowAmount <= grossPrice <= remaining * WAD / factor`, the ceiling of `borrowAmount * factor / WAD` is at most `remaining`.

**If violated** — The stream could not cover the debt, making the loan undercollateralized and causing lender loss.

---

#### X-3

On-chain: **Yes**

> The book's series lookup via the factory registry matches the vault's actual series state — `series(market)` returns accurate `expiryCached`, `ptToken`, and `approved` fields.

**Caller side** — `StreamPricing.sol:193-196` — `marketActive()` calls `IOVRFLOSeriesRegistry(core).series(market)` to read `approved`, `expiryCached`, and `ovrfloToken`.

**Callee side** — `OVRFLO.sol:519-538` — `series()` synthesizes from `_series[market]` storage plus vault immutables (`ovrfloToken`, `underlying`, `oracle`). The `_series[market]` storage is set once in `setSeriesApproved` (I-11) and never modified.

**If violated** — Stream eligibility checks would use wrong expiry or token addresses, allowing ineligible streams to be pledged.

---

#### X-4

On-chain: **Yes**

> The vault's Sablier approval for ovrfloToken persists for the vault's lifetime — `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)` set in the constructor is never revoked.

**Caller side** — `OVRFLO.sol:417-429` — `deposit()` calls `sablierLL.createWithDurations(...)` which transfers ovrfloToken from the vault to the Sablier contract. This requires the vault to have approved Sablier.

**Callee side** — `OVRFLO.sol:236` — Constructor sets `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)`. No function in the codebase revokes or reduces this approval.

**If violated** — Deposits would fail because Sablier cannot pull ovrfloToken from the vault to fund the stream.

---

## 4. Economic Invariants

#### E-1

On-chain: **Yes**

> Combined solvency: `ovrfloToken.totalSupply <= underlying.balanceOf(vault) + ptToken.balanceOf(vault)` — every ovrfloToken is backed by either underlying (from wraps) or PT (from deposits).

**Follows from** — `I-1` (wrappedUnderlying <= underlying balance) + `I-2` (marketTotalDeposited <= PT balance) + ovrfloToken mint/burn accounting: deposits mint `toUser + toStream` against `ptAmount` PT received; wraps mint `amount` against `amount` underlying received; claims burn `amount` and release `amount` PT; unwraps burn `amount` and release `amount` underlying.

**If violated** — Some ovrfloToken holders could not exit through any path (unwrap, claim, or DEX), making the token underbacked.

---

#### E-2

On-chain: **Yes**

> Pool claim fairness: `poolReceived[poolId][account] <= contribution * recovered / totalContributed` — no contributor can receive more than their cumulative pro-rata share of total recovery.

**Follows from** — `I-18` (claimable formula) + `I-3` (Σ contributions == totalContributed). The claimable formula explicitly subtracts `poolReceived`, making it cumulative. `payAmount = min(amount, claimable)` ensures no claim exceeds the computed bound.

**If violated** — A contributor could drain poolProceeds beyond their fair share, leaving other contributors unable to claim.

---

#### E-3

On-chain: **Yes**

> No contributor receives more than their contribution in total: `poolReceived[poolId][account] <= poolContributions[poolId][account]`.

**Follows from** — `I-3` (contribution conservation) + `I-4` (drawn + repaid <= obligation) + `I-18` (claimable formula). Since `recovered = drawn + repaid + min(withdrawable, outstanding) <= obligation` (from I-4, because `drawn + repaid + outstanding = obligation` and `min(withdrawable, outstanding) <= outstanding`), and `obligation <= remaining` (X-2), and `contribution / totalContributed * obligation <= contribution` (because `contribution <= totalContributed` from I-3), the cumulative claim is bounded by the contribution.

**If violated** — A contributor could extract more value than they put in, draining other contributors' shares.
