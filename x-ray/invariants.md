# Invariant Map

> OVRFLO | 26 guards | 9 inferred | 4 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(msg.sender == factory, "OVRFLO: not admin")` · `OVRFLO.sol:208` · Gates every vault admin function to the immutable factory; enforces the multisig -> factory -> vault boundary.

#### G-2
`require(admin != address(0), "OVRFLO: admin is zero address")` · `OVRFLO.sol:222` · Prevents bricking the vault with no admin at construction.

#### G-3
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `OVRFLO.sol:252` · Enforces one-shot series latch; a market's ptToken/expiry/fee cannot be overwritten once set.

#### G-4
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `OVRFLO.sol:253` · Prevents the same PT being mapped to two markets.

#### G-5
`require(market != address(0), "OVRFLO: unknown PT")` · `OVRFLO.sol:281` · Validates the PT is registered before sweep; prevents draining wrap reserve via a non-PT address.

#### G-6
`require(excess > 0, "OVRFLO: no excess")` · `OVRFLO.sol:286` · No-op sweep reverts rather than transferring zero.

#### G-7
`require(balanceAfter - balanceBefore == amount, "OVRFLO: transfer amount mismatch")` · `OVRFLO.sol:320` · Strict balance-delta check on wrap; catches fee-on-transfer / short transfers / deflationary tokens.

#### G-8
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `OVRFLO.sol:333` · Unwrap cannot exceed the tracked wrap reserve (not the raw balance).

#### G-9
`require(oldestObservationSatisfied, "OVRFLO: oracle not ready")` · `OVRFLO.sol:346` · TWAP oracle has enough history for the configured window before any rate read.

#### G-10
`require(toStream > 0, "OVRFLO: nothing to stream")` · `OVRFLO.sol:355` · Deposit reverts at par rate (rate == 1e18) rather than minting with zero stream; ensures every deposit creates a tradeable stream.

#### G-11
`require(ptAmount >= MIN_PT_AMOUNT, "OVRFLO: amount < min PT")` · `OVRFLO.sol:376` · Dust deposit guard (1e6 wei); prevents griefing via tiny deposits.

#### G-12
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:377` · Deposit is pre-maturity only.

#### G-13
`require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `OVRFLO.sol:384` · Per-market deposit cap (0 = unlimited); a low limit serves as an emergency deposit pause without a separate pause flag.

#### G-14
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `OVRFLO.sol:434` · Claim is post-maturity only.

#### G-15
`require(amount <= marketTotalDeposited[market], "OVRFLO: exceeds deposited")` · `OVRFLO.sol:467` · Flash loan cap; cannot lend more PT than tracked deposits.

#### G-16
`require(ret == FLASH_CALLBACK_SUCCESS, "OVRFLO: callback failed")` · `OVRFLO.sol:475` · EIP-3156-inspired callback hash check; borrower must acknowledge the loan terms.

#### G-17
`require(feeBps <= FLASH_FEE_MAX_BPS, "OVRFLO: flash fee too high")` · `OVRFLO.sol:489` · Flash fee ceiling at 1% (100 bps).

#### G-18
`require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high")` · `OVRFLOFactory.sol:194` · Deposit fee ceiling at 1% (100 bps) at addMarket; NOT re-checked at the vault setter (see X-1).

#### G-19
`require(expiry > block.timestamp, "OVRFLOFactory: market expired")` · `OVRFLOFactory.sol:212` · New markets must be pre-maturity; NOT re-checked at the vault setter (see X-3).

#### G-20
`require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOLending: apr too high")` · `OVRFLOLending.sol:265` · Lending APR bound ceiling at 100%.

#### G-21
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOLending: fee too high")` · `OVRFLOLending.sol:279` · Lending fee ceiling at 100% (10000 bps); intentionally permissive so `setLendingFee(10000)` can serve as an emergency circuit breaker that blocks new lending without a separate pause flag.

#### G-22
`require(withdrawable >= outstanding, "OVRFLOLending: loan not closable")` · `OVRFLOLending.sol:463` · closeLoan can only draw what the stream has accrued; prevents drawing unvested ovrfloToken.

#### G-23
`require(amount <= outstanding, "OVRFLOLending: repay too much")` · `OVRFLOLending.sol:494` · Repay capped at outstanding; prevents over-crediting loanPoolProceeds.

#### G-24
`require(liquidityIds[i] > liquidityIds[i - 1], "OVRFLOLending: duplicate or unsorted ids")` · `OVRFLOLending.sol:744` · Strictly-increasing IDs in pool creation; prevents double-consuming the same liquidity.

#### G-25
`require(liquidity.lender != borrower, "OVRFLOLending: self-match")` · `OVRFLOLending.sol:749` · Borrower cannot consume their own liquidity in a pool.

#### G-26
`require(grossPrice > 0, "OVRFLOLending: price zero")` · `OVRFLOLending.sol:801` · Disallows zero-priced fills (would let a stream be sold/pledged for nothing).

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> `StreamPricing.grossPrice` floors and `StreamPricing.obligation` ceils; `obligationForFill(borrowAmount == grossPrice) == remaining`. Directional rounding is load-bearing: `obligation <= remaining` in the partial-borrow path so the pledged stream can always cover the debt.

**Derivation** — Δ-pair: `StreamPricing.sol:108` (`grossPrice = mulDiv(remaining, WAD, factor)` floors) ↔ `StreamPricing.sol:124` (`obligation = mulDiv(borrowAmount, factor, WAD, Rounding.Up)` ceils). NatSpec: `StreamPricing.sol:24-30` "Do not flip either rounding direction without re-checking that analysis."

**If violated** — A partial borrower could owe more than the stream's remaining face, bricking the loan (uncloseable, unrepayable).

---

#### I-2

`Conservation` · On-chain: **No** (not enforced as a single check; holds by construction from I-3 + I-4 + 1:1 mint/burn)

> Combined vault solvency: `OVRFLOToken.totalSupply <= underlying.balanceOf(vault) + ptToken.balanceOf(vault)`. Individual checks (`wrappedUnderlying <= balance`, `marketTotalDeposited <= PT balance`) are sufficient pre-maturity but can break post-maturity when ovrfloToken fungibility allows cross-exits (a wrapper claims PT, a depositor unwraps underlying).

**Derivation** — NatSpec: `CONCEPTS.md` "Combined solvency" + `AGENTS.md` "The correct solvency invariant for an OVRFLO vault is combined". Structural: `wrap` mints 1 ovrfloToken per 1 underlying (`OVRFLO.sol:312-322`); `deposit` mints `toUser + toStream` ovrfloToken per `ptAmount` PT deposited where `toUser + toStream == ptAmount` (`OVRFLO.sol:395-401`); `claim` burns 1 ovrfloToken per 1 PT out (`OVRFLO.sol:441-443`); `unwrap` burns 1 ovrfloToken per 1 underlying out (`OVRFLO.sol:336-339`). The sum holds but no single `require` checks it.

**If violated** — One or more ovrfloToken holders cannot exit through any path (unwrap, claim, or DEX), breaking the core value proposition.

---

#### I-3

`Conservation` · On-chain: **Yes**

> `wrappedUnderlying <= underlying.balanceOf(vault)` at all times. Wrap increments both atomically (with strict balance-delta); unwrap decrements both; sweepExcessUnderlying only transfers balance above `wrappedUnderlying`.

**Derivation** — Δ-pair: `OVRFLO.sol:315` (`wrappedUnderlying += amount`) ↔ `OVRFLO.sol:320` (`balanceAfter - balanceBefore == amount`). `unwrap:333` (`reserve >= amount`) gates the decrement. `sweepExcessUnderlying:300` (`excess = balance - reserve`).

**If violated** — Unwrap would attempt to transfer underlying the vault doesn't hold, reverting and trapping ovrfloToken.

---

#### I-4

`Conservation` · On-chain: **Yes** (pre-maturity); **No** (post-maturity with cross-exits)

> `marketTotalDeposited[market] <= ptToken.balanceOf(vault)` pre-maturity. Post-maturity, a wrapper can claim PT (decrementing `marketTotalDeposited` and PT balance) while a depositor unwraps underlying (decrementing `wrappedUnderlying`), so the individual per-market check can break; the combined I-2 is the real invariant.

**Derivation** — Δ-pair: `OVRFLO.sol:386` (`marketTotalDeposited += ptAmount`) ↔ `OVRFLO.sol:388` (`safeTransferFrom(user, this, ptAmount)`). `claim:441` (`marketTotalDeposited -= amount`) ↔ `claim:443` (`safeTransfer(user, amount)`). Post-maturity break: `claim` by a wrapper burns wrap-origin ovrfloToken and takes PT; `unwrap` by a depositor takes underlying. Both sides of the per-market check move independently.

**If violated** — Pre-maturity: flash loan cap (`G-15`) would over-lend against phantom PT. Post-maturity: covered by I-2.

---

#### I-5

`Conservation` · On-chain: **Yes**

> `loanPoolProceeds[loanId] + Σ loanPoolReceived[loanId][*] == loan.drawn + loan.repaid` (total proceeds ever collected == total drawn from stream + total repaid by borrower). Harvests in `_claimFair` increment `loan.drawn` and `proceeds` atomically; payouts decrement `proceeds` and increment `received`.

**Derivation** — Δ-pair: `closeLoan:468` (`loan.drawn += outstanding; loanPoolProceeds += outstanding`) and `repayLoan:502` (`loan.repaid += amount; loanPoolProceeds += amount`) ↔ `_claimFair:631` (`loanPoolReceived += payAmount; loanPoolProceeds -= payAmount`). Harvest: `_claimFair:623-626` (`loan.drawn += harvestAmount; proceeds += harvestAmount`).

**If violated** — A lender could claim more than their pro-rata share, or proceeds could be stranded/unclaimable.

---

#### I-6

`Bound` · On-chain: **Yes**

> `Σ loanPoolContributions[loanId][*] == loanPools[loanId].totalContributed`. Each `_consumeLiquidity` iteration increments both `loanPoolContributions[loanId][lender]` by `consumed` and the pool's `totalContributed` is set to `actualBorrow128` once; the loop consumes exactly `actualBorrow` total across all lenders.

**Derivation** — guard-lift: `_consumeLiquidity:759-767` increments `loanPoolContributions[loanId][lender] += consumed` while `toBorrow -= consumed` reaches 0 exactly when `Σ consumed == actualBorrow`. `createBorrowerLoanPool:573` sets `totalContributed = actualBorrow128`. Single write site for `totalContributed`; single write path for `loanPoolContributions`.

**If violated** — Pro-rata claim math (`_claimFair`) would divide by a wrong denominator, letting a lender claim more or less than their share.

---

#### I-7

`StateMachine` · On-chain: **Yes**

> `Loan.closed` is a one-shot latch: `false -> true` via `closeLoan` or `repayLoan` (when `amount == outstanding`); no path back to `false`. Once closed, the stream is returned to the borrower and can be re-pledged to a new loan (new ID); the old loan's `drawn`/`repaid` are frozen.

**Derivation** — edge: `Loan.closed` starts `false` (`_storeLoan:821`). `closeLoan:465` (`loan.closed = true`) guarded by `require(!loan.closed)` at `:458`. `repayLoan:499` (`loan.closed = true` when `amount == outstanding`) guarded by `require(!loan.closed)` at `:488`. No function sets `closed = false`.

**If violated** — A closed loan could be re-closed or re-repaid, double-crediting `loanPoolProceeds` or re-transferring an already-returned stream.

---

#### I-8

`Bound` · On-chain: **Yes**

> `loan.drawn + loan.repaid <= loan.obligation` always (so `_outstanding = obligation - drawn - repaid` never underflows). `closeLoan` draws exactly `outstanding`; `repayLoan` caps at `outstanding`; `_claimFair` harvest caps at `min(withdrawable, outstanding)`.

**Derivation** — guard-lift: `G-22` (`closeLoan` draws `outstanding` after `require(withdrawable >= outstanding)`), `G-23` (`repayLoan` `require(amount <= outstanding)`), `_claimFair:619` (`harvestAmount = min(request - proceeds, min(withdrawable, outstanding))`). All three write sites of `loan.drawn`/`loan.repaid` are bounded by `outstanding`.

**If violated** — `_outstanding` would underflow (revert in Solidity 0.8+), bricking `closeLoan`/`repayLoan`/`claimLoanPoolShare` for that loan.

---

#### I-9

`Bound` · On-chain: **Yes** (ceiling enforced at setter); **No** (ceiling value is permissive by design)

> `OVRFLOLending.feeBps <= MAX_FEE_BPS (10000)` and `aprMaxBps <= APR_MAX_CEILING (10000)`. Both enforced at their setters. `MAX_FEE_BPS = 10000` (100%) is intentionally permissive: `setLendingFee(10000)` acts as an emergency circuit breaker that blocks new lending interactions (100% fee = zero net to seller/borrower) without requiring a separate pause flag on every lending function. The same pattern applies to `setMarketDepositLimit` in OVRFLO (a low limit effectively pauses deposits). Sale listings are protected by per-post fee snapshots. All setters are gated by the on-chain timelock.

**Derivation** — guard-lift: `setFee:279` (`require(feeBps_ <= MAX_FEE_BPS)`) is the only write site of `feeBps`. `setAprBounds:265` (`require(aprMaxBps_ <= APR_MAX_CEILING)`) is the only write site of `aprMaxBps`. Both On-chain=Yes for the bound. The 100% ceiling is a deliberate design choice (circuit breaker), not an oversight.

**If violated** — If the bound were removed entirely, the owner could set `feeBps > 10000` which would cause `netToSeller` to underflow. The current 100% ceiling is safe; the circuit-breaker use case is intentional.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **No**

> `OVRFLO.setSeriesApproved` writes `feeBps` to `_series[market].feeBps` without checking `feeBps <= 100`. The bound is enforced only at `OVRFLOFactory.addMarket:194` (`require(feeBps <= FEE_MAX_BPS)`). Since `setSeriesApproved` is `onlyAdmin` (= factory) and the factory always checks, the bound holds, but the vault setter itself is unguarded.

**Caller side** — `OVRFLOFactory.sol:194` — `require(feeBps <= FEE_MAX_BPS)` before calling `setSeriesApproved`.

**Callee side** — `OVRFLO.sol:247-258` — `setSeriesApproved` writes `info.feeBps = feeBps` with no bound check.

**If violated** — If a future code path calls `setSeriesApproved` directly (bypassing the factory), a deposit fee > 1% could be set, silently overcharging depositors.

---

#### X-2

On-chain: **No**

> `OVRFLO.setSeriesApproved` writes `twapDurationFixed` without checking `twapDuration ∈ [15min, 30min]`. The bound is enforced only at `OVRFLOFactory._validateTwapBounds` (called by `addMarket` and `prepareOracle`).

**Caller side** — `OVRFLOFactory.sol:191` — `_validateTwapBounds(twapDuration)` inside `addMarket` before calling `setSeriesApproved`.

**Callee side** — `OVRFLO.sol:247-258` — `setSeriesApproved` writes `info.twapDurationFixed = twapDuration` with no bound check.

**If violated** — A too-short TWAP window would make `getPtToSyRate` manipulable by single-block flash loans; a too-long window would reject deposits with "oracle not ready" for new markets.

---

#### X-3

On-chain: **No**

> `OVRFLO.setSeriesApproved` writes `expiryCached` without checking `expiry > block.timestamp`. The bound is enforced only at `OVRFLOFactory.addMarket:212` (`require(expiry > block.timestamp)`). A vault called directly could approve an already-expired market; `deposit` would then revert at `block.timestamp < expiry` (harmless), but `claim` would be immediately callable.

**Caller side** — `OVRFLOFactory.sol:212` — `require(expiry > block.timestamp, "OVRFLOFactory: market expired")` before calling `setSeriesApproved`.

**Callee side** — `OVRFLO.sol:247-258` — `setSeriesApproved` writes `info.expiryCached = expiry` with no temporal check.

**If violated** — An expired market approved via a bypassed factory would let `claim` run immediately against any ovrfloToken (though no PT was deposited through that market, so `marketTotalDeposited` would be 0 and `claim` would revert at `currentDeposited >= amount`).

---

#### X-4

On-chain: **Yes**

> `StreamPricing.marketActive` derives market approval from `IOVRFLOSeriesRegistry(core).series(market)` returning `ptToken != address(0)`. The core vault's `setSeriesApproved` is a one-shot latch (`require(info.ptToken == address(0))` then `info.ptToken = pt`); there is no path to reset `ptToken` to `address(0)`. So once a market is approved, `marketActive` will never revert with `MarketNotApproved` for that market.

**Caller side** — `StreamPricing.sol:178-181` — `marketActive` reads `series(market)` and checks `ptToken_ == address(0)`.

**Callee side** — `OVRFLO.sol:247-258` — `setSeriesApproved` is the only writer of `_series[market].ptToken`; guarded by `require(info.ptToken == address(0))` (one-shot).

**If violated** — A market could appear approved to `marketActive` while the vault has no PT backing for it, or vice versa. The one-shot latch prevents both.

---

## 4. Economic Invariants

#### E-1

On-chain: **No** (derives from I-2 which is On-chain=No)

> Every ovrfloToken holder can exit through some path (unwrap, claim, or DEX) as long as the combined solvency invariant holds. No holder is forced into a particular exit path; ovrfloToken fungibility across deposit and wrap origins is a design feature that increases exit optionality.

**Follows from** — `I-2` (combined solvency) + `I-3` (wrap reserve) + `I-4` (deposit accounting, pre-maturity).

**If violated** — A holder is trapped: cannot unwrap (reserve insufficient), cannot claim (no PT backing), cannot DEX (no liquidity). This is the protocol's existential risk.

---

#### E-2

On-chain: **Yes** (derives from I-5 + I-6 which are On-chain=Yes)

> Pro-rata fairness of loan-pool claims: no lender can receive more than `contribution * recovered / totalContributed` cumulatively, and the sum of all lenders' received amounts cannot exceed `recovered`. Floor division may strand wei-level dust in `loanPoolProceeds`, but no lender can claim more than their share.

**Follows from** — `I-5` (proceeds conservation) + `I-6` (contributions sum to totalContributed) + `_claimFair:610-611` (`claimable = contribution * recovered / totalContributed - received`).

**If violated** — A lender could drain `loanPoolProceeds` beyond their share, defrauding other lenders in the same pool.
