# Invariant Map

> OVRFLO | 35 guards | 24 inferred | 1 not enforced on-chain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below are anchor targets from `x-ray.md`.

#### G-1
`require(msg.sender == factory, "OVRFLO: not admin")` · `OVRFLO.sol:212` · Restricts vault configuration and asset recovery to the immutable factory.

#### G-2
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `OVRFLO.sol:256` · Keeps every market's series metadata immutable after onboarding.

#### G-3
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `OVRFLO.sol:257` · Prevents one PT from being accounted under multiple markets.

#### G-4
`require(ptToMarket[ptToken] != address(0), "OVRFLO: unknown PT")` · `OVRFLO.sol:285` · Prevents the PT sweep path from treating the underlying or an arbitrary token as excess PT.

#### G-5
`require(excess > 0, "OVRFLO: no excess")` · `OVRFLO.sol:290` · Preserves tracked PT backing during admin recovery.

#### G-6
`require(excess > 0, "OVRFLO: no excess")` · `OVRFLO.sol:305` · Preserves the tracked wrap reserve during underlying recovery.

#### G-7
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `OVRFLO.sol:337` · Limits unwraps to the accounting reserve available for that exit path.

#### G-8
`require(oldestObservationSatisfied, "OVRFLO: oracle not ready")` · `OVRFLO.sol:350` · Rejects PT valuation when the configured TWAP history is not ready.

#### G-9
`require(info.approved, "OVRFLO: market not approved")` · `OVRFLO.sol:377` · Limits deposits to immutable, factory-onboarded series.

#### G-10
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:379` · Stops new stream creation once the PT has matured.

#### G-11
`require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `OVRFLO.sol:386` · Applies the configured market cap to each new deposit.

#### G-12
`require(market != address(0), "OVRFLO: unknown PT")` · `OVRFLO.sol:436` · Routes claims only through configured PT mappings.

#### G-13
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `OVRFLO.sol:439` · Prevents redemption of PT before maturity.

#### G-14
`require(currentDeposited >= amount, "OVRFLO: deposit accounting")` · `OVRFLO.sol:443` · Prevents a claim from underflowing tracked PT liabilities.

#### G-15
`require(!flashLoanPaused, "OVRFLO: flash paused")` · `OVRFLO.sol:468` · Enforces the factory-controlled flash-loan circuit breaker.

#### G-16
`require(amount <= marketTotalDeposited[market], "OVRFLO: exceeds deposited")` · `OVRFLO.sol:471` · Caps a PT flash loan at the tracked market inventory.

#### G-17
`require(feeBps <= FLASH_FEE_MAX_BPS, "OVRFLO: flash fee too high")` · `OVRFLO.sol:495` · Keeps the flash fee within the immutable one-percent ceiling.

#### G-18
`require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed")` · `OVRFLOFactory.sol:108` · Enforces one vault and one fungible claim token per underlying.

#### G-19
`require(pendingDeployment.pending, "OVRFLOFactory: nothing pending")` · `OVRFLOFactory.sol:134` · Requires a staged configuration before deployment consumes it.

#### G-20
`require(ovrfloToLending[ovrflo] == address(0), "OVRFLOFactory: lending exists")` · `OVRFLOFactory.sol:168` · Enforces one factory-registered lending market per vault.

#### G-21
`require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long")` · `OVRFLOFactory.sol:193` · Bounds the oracle averaging window used by the vault.

#### G-22
`require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short")` · `OVRFLOFactory.sol:194` · Rejects short TWAP windows during market onboarding.

#### G-23
`require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high")` · `OVRFLOFactory.sol:195` · Caps per-series deposit fees at one percent.

#### G-24
`require(oldestObservationSatisfied, "OVRFLOFactory: oracle not ready")` · `OVRFLOFactory.sol:201` · Requires usable historical observations before series approval.

#### G-25
`require(IStandardizedYield(sy).yieldToken() == info.underlying, "OVRFLOFactory: underlying mismatch")` · `OVRFLOFactory.sol:209` · Prevents unrelated Pendle series from sharing one claim token.

#### G-26
`require(aprMaxBps_ >= aprMinBps_, "OVRFLOLENDING: bad apr bounds")` · `OVRFLOLending.sol:276` · Preserves a non-inverted APR interval.

#### G-27
`require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOLENDING: apr too high")` · `OVRFLOLending.sol:277` · Caps governance-set APR bounds at 100 percent.

#### G-28
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOLENDING: fee too high")` · `OVRFLOLending.sol:291` · Prevents fee arithmetic from exceeding the transferred principal or price.

#### G-29
`require(liquidity.active, "OVRFLOLENDING: liquidity inactive")` · `OVRFLOLending.sol:346` · Prevents reuse of cancelled or fully consumed liquidity.

#### G-30
`require(liquidity.lender == msg.sender, "OVRFLOLENDING: not lender")` · `OVRFLOLending.sol:347` · Restricts liquidity withdrawal to its funding account.

#### G-31
`require(grossPrice <= liquidity.availableLiquidity, "OVRFLOLENDING: insufficient availableLiquidity")` · `OVRFLOLending.sol:374` · Caps sale settlement at escrowed underlying capacity.

#### G-32
`require(!loan.closed, "OVRFLOLENDING: loan closed")` · `OVRFLOLending.sol:482` · Prevents a closed loan from being serviced twice.

#### G-33
`require(withdrawable >= outstanding, "OVRFLOLENDING: loan not closable")` · `OVRFLOLending.sol:486` · Allows permissionless close only when accrued stream value covers debt.

#### G-34
`require(amount <= outstanding, "OVRFLOLENDING: repay too much")` · `OVRFLOLending.sol:518` · Caps borrower repayment at the remaining obligation.

#### G-35
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOLENDING: apr out of bounds")` · `OVRFLOLending.sol:879` · Constrains every new order to the current governance-set APR range.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> At transaction boundaries, `OVRFLOToken.totalSupply() == wrappedUnderlying + Σ marketTotalDeposited[market]`.

**Derivation** — Δ-pairs: `wrap` increments reserve and mints equally (`OVRFLO.sol:319,326`); `unwrap` decrements reserve and burns equally (`OVRFLO.sol:339-340`); `deposit` increments market deposits by `ptAmount` and mints `toUser + toStream == ptAmount` (`OVRFLO.sol:388,356-359,405-406`); `claim` decrements deposits and burns equally (`OVRFLO.sol:444,446`). OVRFLOToken supply deltas are unambiguous OZ `_mint` and `_burn` effects.

**If violated** — Fungible token liabilities diverge from the two accounting buckets.

#### I-2

`Conservation` · On-chain: **Yes**

> At transaction boundaries, each market's tracked PT deposits change one-for-one with successful deposit and claim PT transfers.

**Derivation** — Δ-pairs: `Δ(marketTotalDeposited) = +ptAmount` with PT transfer-in (`OVRFLO.sol:388,391`); `Δ(marketTotalDeposited) = -amount` with PT transfer-out (`OVRFLO.sol:444,447`). Flash loans have zero persistent storage delta and pull the exact principal back (`OVRFLO.sol:478-483`).

**If violated** — Claim capacity and PT sweep calculations no longer describe the market's inventory.

#### I-3

`Conservation` · On-chain: **Yes**

> `wrappedUnderlying` changes one-for-one with successful wrap inflows and unwrap outflows; direct donations do not increase it.

**Derivation** — Δ-pairs: reserve `+amount` and strict underlying balance delta (`OVRFLO.sol:319-324`); reserve `-amount` and underlying transfer-out (`OVRFLO.sol:339-341`). No other write sites exist.

**If violated** — The reserved 1:1 unwrap capacity becomes detached from its accounting source.

#### I-4

`Bound` · On-chain: **No**

> For a nonzero market cap, `marketTotalDeposited[market] <= marketDepositLimits[market]` globally.

**Derivation** — Guard lift: deposits enforce `currentDeposited + ptAmount <= limit` (`OVRFLO.sol:382-388`), but the complete write-site scan finds `setMarketDepositLimit` can lower `limit` below current deposits without an equivalent check (`OVRFLO.sol:273-275`).

**If violated** — Existing deposits may exceed a newly configured cap, while subsequent deposits remain blocked.

#### I-5

`StateMachine` · On-chain: **Yes**

> A market and PT mapping are configured once and have no reverse transition.

**Derivation** — Edges: `_series[market].ptToken == 0@256 → pt@263`; `ptToMarket[pt] == 0@257 → market@265`. The write-site scan finds no reset path.

**If violated** — Existing claims or lending eligibility could resolve against changed series metadata.

#### I-6

`Bound` · On-chain: **Yes**

> `flashFeeBps <= 100` at every write site.

**Derivation** — Guard lift: constructor default is zero and the sole setter enforces `feeBps <= FLASH_FEE_MAX_BPS` before assignment (`OVRFLO.sol:494-496`).

**If violated** — Flash fee calculations exceed the documented one-percent maximum.

#### I-7

`Temporal` · On-chain: **Yes**

> Deposits and flash loans are pre-maturity operations; PT claims are post-maturity operations.

**Derivation** — Temporal predicates: `block.timestamp < info.expiryCached` at `OVRFLO.sol:379,469`; `block.timestamp >= info.expiryCached` at `OVRFLO.sol:439`.

**If violated** — Stream creation, temporary PT lending, and redemption overlap outside their intended phases.

#### I-8

`StateMachine` · On-chain: **Yes**

> A configured underlying can map to only one deployed vault.

**Derivation** — Edge: `underlyingToOvrflo[underlying] == 0@108 → ovrflo@155` in `OVRFLOFactory.sol`, with no clearing write site.

**If violated** — One underlying could acquire competing fungible claim-token systems.

#### I-9

`StateMachine` · On-chain: **Yes**

> A known vault can receive only one factory-registered OVRFLOLENDING deployment.

**Derivation** — Edge: `ovrfloToLending[ovrflo] == 0@168 → lending@174` in `OVRFLOFactory.sol`, with no clearing write site.

**If violated** — Factory registry consumers could disagree about the canonical secondary market.

#### I-10

`Bound` · On-chain: **Yes**

> `15 minutes <= twapDuration <= 30 minutes` and series deposit fee `<= 100 bps` for every factory-onboarded market.

**Derivation** — Guard lift: `addMarket` validates all three bounds (`OVRFLOFactory.sol:193-195`) before its only call to the one-shot series writer (`OVRFLOFactory.sol:212`); the market configuration cannot be overwritten by I-5.

**If violated** — A series would use oracle or fee parameters outside factory policy.

#### I-11

`Bound` · On-chain: **Yes**

> `0 <= aprMinBps <= aprMaxBps <= 10_000`, and both APR bounds are multiples of 100 bps.

**Derivation** — Guard lift and write sites: constructor initializes both to `1000` (`OVRFLOLending.sol:262-263`); the only setter validates order, ceiling, and step alignment before both assignments (`OVRFLOLending.sol:275-282`).

**If violated** — New-order validation would operate over an invalid APR interval.

#### I-12

`Bound` · On-chain: **Yes**

> `feeBps <= 10_000` at every lending-market write site.

**Derivation** — Guard lift: constructor default is zero; the sole setter checks `feeBps_ <= MAX_FEE_BPS` before assignment (`OVRFLOLending.sol:290-293`).

**If violated** — `feeAmount` could exceed price or principal and underflow net proceeds.

#### I-13

`StateMachine` · On-chain: **Yes**

> Liquidity, listing, loan, and loan-pool IDs are unique and monotonically increase from one.

**Derivation** — One-way edges: `nextLiquidityId++@332`, `nextSaleListingId++@414`, `nextLoanPoolId++@594`, and `nextLoanId++@922` in `OVRFLOLending.sol`; no decrement or reset write sites exist.

**If violated** — New records could overwrite live or historical positions.

#### I-14

`StateMachine` · On-chain: **Yes**

> Active liquidity always has positive `availableLiquidity`; reaching zero makes it inactive and it never reactivates.

**Derivation** — Edges: creation requires positive capacity and writes active (`OVRFLOLending.sol:330-334`); withdrawal writes `0,false` (`:349-351`); both fill paths decrement and set false at zero (`:380-382`, `:868-870`); no false-to-true update exists for an existing ID.

**If violated** — A consumed or withdrawn position could be selected for another settlement.

#### I-15

`StateMachine` · On-chain: **Yes**

> A sale listing transitions once from active to inactive through cancellation or purchase.

**Derivation** — Edge: `active=true@415-417 → false@431` or `false@457`; no existing listing is reactivated.

**If violated** — An escrowed stream could be sold or returned more than once.

#### I-16

`Conservation` · On-chain: **Yes**

> For every loan, `outstanding = obligation - drawn - repaid`, and `drawn + repaid <= obligation`.

**Derivation** — Δ-pairs and caps: `_outstanding` is exact subtraction (`OVRFLOLending.sol:940-942`); close adds exactly outstanding to drawn (`:484-493`); repay requires `amount <= outstanding` before adding to repaid (`:515-528`); claim harvest is capped by outstanding (`:656-664`).

**If violated** — Loan servicing arithmetic can underflow or recover above the obligation.

#### I-17

`StateMachine` · On-chain: **Yes**

> `loan.closed` becomes true only when `drawn + repaid == obligation`, and has no reverse transition.

**Derivation** — Edges: close computes outstanding then sets closed and adds it to drawn (`OVRFLOLending.sol:484-493`); repay sets closed only when `amount == outstanding` (`:515-528`); no closed-to-open writer exists.

**If violated** — Stream return could occur before full satisfaction or remain escrowed after satisfaction.

#### I-18

`Conservation` · On-chain: **Yes**

> For each loan pool, the sum of lender contributions equals `totalContributed`.

**Derivation** — Δ-pair: pool stores `actualBorrow128` as total contributed (`OVRFLOLending.sol:594-601`), then `_consumeLiquidity` allocates exactly that amount by decrementing `toBorrow` and incrementing lender contributions by each consumed amount (`:862-874`); validation sums active availability before sizing (`:581-590,845-859`).

**If violated** — Pro-rata lender shares do not partition the funded principal.

#### I-19

`Conservation` · On-chain: **Yes**

> For each pool, `loanPoolProceeds + Σ loanPoolReceived == loan.drawn + loan.repaid`.

**Derivation** — Δ-pairs: close increases drawn and proceeds equally (`OVRFLOLending.sol:490-493`); repay increases repaid and proceeds equally (`:520-528`); claim harvest increases drawn and proceeds equally (`:663-664`); payout decreases proceeds and increases receiver totals equally (`:671-673`).

**If violated** — Pool recovery accounting diverges from token proceeds distributed or held.

#### I-20

`Ratio` · On-chain: **Yes**

> A lender's cumulative pool entitlement is `contribution * recovered / totalContributed`, less amounts already received.

**Derivation** — Ratio formula uses the contribution, recovered snapshot, pool total, and prior receipt before any claim mutation (`OVRFLOLending.sol:640-652`); payout then increments receipt by the same amount (`:668-673`).

**If violated** — Lenders do not receive the recorded pro-rata share of recovered value.

#### I-21

`Ratio` · On-chain: **Yes**

> `factor >= 1e18`, `grossPrice <= remaining`, and fee is at most the charged amount under configured fee bounds.

**Derivation** — Exact formulas: nonnegative APR/time is added to WAD (`StreamPricing.sol:111-112`); price multiplies remaining by WAD and divides by factor (`:122-123`); fee divides by `10_000` (`:173-174`) while I-12 bounds `feeBps`.

**If violated** — Present-value or fee arithmetic exceeds its face-value input.

#### I-22

`Ratio` · On-chain: **Yes**

> A full-price borrow owes exactly the remaining stream face value; a partial borrow uses ceiling-rounded linear accrual.

**Derivation** — NatSpec and exact branch: `borrowAmount == grossPrice_` returns `remaining`, otherwise calls ceiling-rounded `obligation` (`StreamPricing.sol:145-166`); the caller enforces borrow not above gross price (`OVRFLOLending.sol:583`).

**If violated** — The pledged stream may not cover the recorded obligation.

#### I-23

`Temporal` · On-chain: **Yes**

> Lending posts and fills operate only while both factory and vault approve the market and before cached maturity.

**Derivation** — Temporal and registry predicates: `marketActive` checks factory approval, series approval, and `block.timestamp < expiryCached_` (`StreamPricing.sol:187-196`); all posting and filling routes call it directly or through `requireEligible`.

**If violated** — Orders can be created or settled against inactive series.

#### I-24

`Conservation` · On-chain: **Yes**

> A sale's gross underlying price equals seller proceeds plus treasury fee.

**Derivation** — Δ-pair: `feeAmount = fee(grossPrice, feeBps)` and `netToSeller = grossPrice - feeAmount`, followed by exact pull/payment paths (`OVRFLOLending.sol:376-387,454-462`).

**If violated** — Escrowed underlying no longer reconciles with sale settlement outputs.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **Yes**

> Factory market approval and the vault's one-shot series configuration are committed atomically.

**Caller side** — `OVRFLOFactory.sol:212-216` — `addMarket` first calls `OVRFLO.setSeriesApproved`, then writes the factory approval registry in the same transaction.

**Callee side** — `OVRFLO.sol:251-265` — the vault writes immutable series data and the PT reverse mapping; a revert rolls back both contracts.

**If violated** — StreamPricing could observe disagreement between factory and vault market registries.

#### X-2

On-chain: **Yes**

> Every factory-deployed lending market snapshots the served vault's treasury, underlying, and ovrfloToken from the factory registry.

**Caller side** — `OVRFLOFactory.sol:166-177` — deployment passes the factory and known vault, then registers the returned lending address.

**Callee side** — `OVRFLOLending.sol:246-263` — constructor reads `ovrfloInfo(core_)`, rejects zero registry values, and stores the three immutable dependencies.

**If violated** — Sale and loan settlement assets could differ from the core vault's claim system.

#### X-3

On-chain: **Yes**

> Every accepted stream has the core vault as sender, the vault's ovrfloToken as asset, the series expiry as end time, no cliff, non-cancelability, and positive remaining balance.

**Caller side** — `OVRFLOLending.sol:365-371,406-412,443-449,553-578` — all stream-bound sale and loan entry points consume `StreamPricing.requireEligible` output.

**Callee side** — `StreamPricing.sol:211-235` — eligibility reads both in-scope registries and validates each Sablier field before returning remaining value.

**If violated** — Pricing or collateral accounting can consume a stream with different payout semantics.

#### X-4

On-chain: **Yes**

> OVRFLO is the only account able to mint or burn its deployed OVRFLOToken.

**Caller side** — `OVRFLO.sol:326,340,405-406,446` — the vault invokes mint and burn for wrap, unwrap, deposit, and claim.

**Callee side** — `OVRFLOToken.sol:10-31` and `OVRFLOFactory.sol:140-155` — token methods require owner; factory deployment transfers ownership to the new vault before registry publication.

**If violated** — Token supply could change without a matching vault accounting delta.

#### X-5

On-chain: **Yes**

> The factory validates Pendle SY underlying identity and oracle readiness before the vault stores a market's immutable series data.

**Caller side** — `OVRFLOFactory.sol:191-212` — reads Pendle oracle state and market/SY metadata, then forwards validated parameters.

**Callee side** — `OVRFLO.sol:251-265` — stores the one-shot market configuration used by deposits, claims, and StreamPricing.

**If violated** — A shared fungible claim token could represent unrelated backing or an unusable oracle window.

---

## 4. Economic Invariants

#### E-1

On-chain: **Yes**

> At transaction boundaries, total fungible liabilities are covered in aggregate by vault underlying plus all configured PT balances; deposit-origin and wrap-origin tokens may intentionally cross-exit.

**Follows from** — `I-1` + `I-2` + `I-3` + `X-4`

**If violated** — Aggregate assets cannot cover the fungible token supply across claim and unwrap paths.

#### E-2

On-chain: **Yes**

> Every originated loan obligation is bounded by the eligible stream's remaining face value.

**Follows from** — `I-16` + `I-22` + `X-3`

**If violated** — Self-repayment cannot satisfy the recorded debt from pledged stream value.

#### E-3

On-chain: **Yes**

> Pool lenders collectively receive no more than recorded loan recovery, partitioned by contributed principal.

**Follows from** — `I-18` + `I-19` + `I-20`

**If violated** — Shared proceeds can be over-distributed or allocated inconsistently among lenders.

#### E-4

On-chain: **Yes**

> Every sale or loan principal settlement conserves underlying between user proceeds, protocol fee, and consumed escrowed liquidity.

**Follows from** — `I-12` + `I-24`

**If violated** — The lending market's underlying balance diverges from funded positions and settlement outputs.
