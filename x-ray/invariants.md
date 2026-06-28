# Invariant Map

> OVRFLO | 18 guards | 13 inferred | 7 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(msg.sender == adminContract, "OVRFLO: not admin")` · `OVRFLO.sol:208` · Gates all vault admin functions (series approval, deposit limits, sweeps) to the factory admin hub.

#### G-2
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `OVRFLO.sol:232` · One-shot series latch — a market can be configured exactly once; backs I-9 immutability.

#### G-3
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `OVRFLO.sol:233` · One-shot reverse-map latch — a PT cannot be remapped to a second market.

#### G-4
`require(ptAmount >= MIN_PT_AMOUNT, "OVRFLO: amount < min PT")` · `OVRFLO.sol:335` · Dust-deposit gate; `MIN_PT_AMOUNT = 1e6` is a vault constant.

#### G-5
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `OVRFLO.sol:336` · Temporal gate — deposits only allowed pre-maturity; backs I-11.

#### G-6
`require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `OVRFLO.sol:341` · Per-market cap (only when `limit > 0`); backs I-8 (bound holds at deposit, not at setter).

#### G-7
`require(toStream > 0, "OVRFLO: nothing to stream")` · `OVRFLO.sol:352` · Ensures a non-trivial split; rejects rate >= 1e18 (PT at/above par).

#### G-8
`require(toUser >= minToUser, "OVRFLO: slippage")` · `OVRFLO.sol:353` · User slippage protection on the immediate portion.

#### G-9
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `OVRFLO.sol:393` · Temporal gate — claims only after maturity; the complement of G-5.

#### G-10
`require(currentDeposited >= amount, "OVRFLO: deposit accounting")` · `OVRFLO.sol:397` · Per-market claim bounded by tracked deposits; backs I-1 conservation.

#### G-11
`require(balanceAfter - balanceBefore == amount, "OVRFLO: transfer amount mismatch")` · `OVRFLO.sol:293` · `wrap` balance-delta check — rejects fee-on-transfer underlying; backs I-2.

#### G-12
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `OVRFLO.sol:307` · `unwrap` cannot drain past `wrappedUnderlying`; backs I-2.

#### G-13
`require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds")` · `OVRFLOBook.sol:314` · APR bound ordering at the only setter; backs I-5.

#### G-14
`require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high")` · `OVRFLOBook.sol:315` · Hardcoded 100% ceiling on the APR max; backs I-5.

#### G-15
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high")` · `OVRFLOBook.sol:328` · Hardcoded 100% ceiling on the book fee; backs I-4.

#### G-16
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds")` · `OVRFLOBook.sol:916` · Per-post APR gate; backs I-6 (enforced at post, not retained after bound changes).

#### G-17
`require(amount <= outstanding, "OVRFLOBook: repay too much")` · `OVRFLOBook.sol:783` · Repayment capped at outstanding; backs the loan conservation E-2.

#### G-18
`require(withdrawable >= outstanding, "OVRFLOBook: loan not closable")` · `OVRFLOBook.sol:742` · `closeLoan` only when the stream can cover the debt; backs E-2 liveness.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **No**

> For every approved market, `IERC20(ptToken).balanceOf(vault) >= marketTotalDeposited[market]`, so every ovrfloToken claim is backed by a claimable PT.

**Derivation** — Δ-pair: `OVRFLO.deposit:340-343` does `safeTransferFrom(pt)` then `Δ(marketTotalDeposited[market]) = +ptAmount`; `OVRFLO.claim:397-401` does `Δ(marketTotalDeposited[market]) = -amount` then `safeTransfer(pt, amount)`. `sweepExcessPt:262` removes only `balance - deposited`. **Gap**: `deposit` pulls PT *without* a balance-delta check (contrast G-11 on `wrap`), so a fee-on-transfer PT would advance `marketTotalDeposited` by more than the received balance. On-chain=**No** — the conservation relies on the exact-transfer token assumption.

**If violated** — `marketTotalDeposited` exceeds real PT balance; a claimant burns ovrfloToken but the PT transfer fails (or later claimants are shortchanged).

---

#### I-2

`Conservation` · On-chain: **Yes**

> `IERC20(underlying).balanceOf(vault) >= wrappedUnderlying`, so every wrapped ovrfloToken is redeemable 1:1.

**Derivation** — Δ-pair: `OVRFLO.wrap` does `Δ(wrappedUnderlying) = +amount` before the transfer (CEI), with a balance-delta check (G-11) on the received amount; `OVRFLO.unwrap:307-313` does `Δ(wrappedUnderlying) = -amount` behind `reserve >= amount` (G-12); `sweepExcessUnderlying:276` removes only `balance - wrappedUnderlying`. Every write site of `wrappedUnderlying` preserves the inequality.

**If violated** — `unwrap` could fail or late wrappers be unable to redeem.

---

#### I-3

`Bound` · On-chain: **Yes**

> `SeriesInfo.feeBps <= FEE_MAX_BPS (100)` for every approved market.

**Derivation** — guard-lift: `OVRFLOFactory.addMarket:153` enforces `require(feeBps <= FEE_MAX_BPS)`; `setSeriesApproved` is the only other writer of `feeBps` and is callable only by the factory (G-1), gated by the one-shot latch (G-2) so the fee is set exactly once per market. All write sites enforce the bound.

**If violated** — deposit fee could exceed the intended 1% ceiling.

---

#### I-4

`Bound` · On-chain: **Yes**

> `OVRFLOBook.feeBps <= MAX_FEE_BPS (10_000)`.

**Derivation** — guard-lift: `OVRFLOBook.setFee:328` enforces G-15; it is the only writer of `feeBps` (constructor initializes to `LAUNCH_APR_BPS`... actually to 0 then owner sets). Single guarded write site.

**If violated** — protocol fee could exceed 100%, trapping fills.

---

#### I-5

`Bound` · On-chain: **Yes**

> `aprMinBps <= aprMaxBps <= APR_MAX_CEILING (10_000)`.

**Derivation** — guard-lift: `OVRFLOBook.setAprBounds:314-315` enforces G-13 + G-14; constructor sets both to `LAUNCH_APR_BPS (1000)`. Only writer is the guarded setter.

**If violated** — APR bounds could invert or exceed 100%, breaking pricing assumptions.

---

#### I-6

`Bound` · On-chain: **No**

> Every *posted* offer/listing `aprBps` was within `[aprMinBps, aprMaxBps]` at post time, but not necessarily within current bounds thereafter.

**Derivation** — guard-lift: `_validateApr` (G-16) checks `aprBps ∈ [aprMinBps, aprMaxBps]` at every `post*` callsite. **Gap**: `setAprBounds` (the only writer of `aprMinBps`/`aprMaxBps`) does not touch existing offers/listings, so a bound change can leave active orders outside the new range. On-chain=**No** — by design (makers keep their posted APR), but the global property "all active aprBps ∈ current bounds" does not hold.

**If violated** — resting offers may carry APRs outside current policy; this is intentional maker protection, not a bug, but auditors should confirm no fill path re-validates APR against live bounds.

---

#### I-7

`Bound` · On-chain: **Yes**

> `SeriesInfo.twapDurationFixed ∈ [MIN_TWAP_DURATION (15m), MAX_TWAP_DURATION (30m)]`.

**Derivation** — guard-lift: `OVRFLOFactory.addMarket:150-151` enforces both bounds; one-shot latch (G-2) means the value is immutable after approval. Single guarded write site.

**If violated** — oracle window could be too short (manipulable) or too long (stale).

---

#### I-8

`Bound` · On-chain: **No**

> `marketTotalDeposited[market] <= marketDepositLimits[market]` whenever `limit > 0`.

**Derivation** — guard-lift: `OVRFLO.deposit:340-341` (G-6) enforces `currentDeposited + ptAmount <= limit` at deposit. **Gap**: `setMarketDepositLimit` (factory `OVRFLOFactory.sol:180` and vault `OVRFLO.sol:247`) writes `marketDepositLimits[market]` with **no check** against the current `marketTotalDeposited`. The admin can lower the cap below already-deposited principal. On-chain=**No** — new deposits block, but the bound "deposited <= limit" is broken for the lowered case.

**If violated** — existing deposits exceed the stated cap; claims still work (G-10), but the limit no longer bounds total exposure.

---

#### I-9

`StateMachine` · On-chain: **Yes**

> A market series, once configured, is immutable: `ptToken`, `ovrfloToken`, `underlying`, `oracle`, `expiryCached`, `twapDurationFixed`, `feeBps` never change.

**Derivation** — edge: `unconfigured (ptToken == 0) → configured` via `setSeriesApproved` (G-2 + G-3); no update/override function exists. `setSeriesApproved` reverts if already configured. No reverse path.

**If violated** — claims (which depend on `ptToken`/`ovrfloToken`/`expiryCached` permanence) would break for outstanding deposits.

---

#### I-10

`StateMachine` · On-chain: **Yes**

> A loan transitions `open → closed` exactly once; no loan op is callable after `closed`.

**Derivation** — edge: `Loan.closed = false` at `_storeLoan`; `closeLoan:739` and `repayLoan:787` set `closed = true`; `claimLoan:716`, `closeLoan:737`, `repayLoan:777` all require `!loan.closed`. No reopen path.

**If violated** — a closed loan could be re-drawn or double-settled.

---

#### I-11

`Temporal` · On-chain: **Yes**

> Deposits occur only before `expiryCached`; claims occur only at/after `expiryCached`.

**Derivation** — temporal: `OVRFLO.deposit:336` (G-5) `require(block.timestamp < expiryCached)`; `OVRFLO.claim:393` (G-9) `require(block.timestamp >= expiryCached)`. Complementary predicates on the same stored `expiryCached`.

**If violated** — post-maturity deposits would create unbacked streams; pre-maturity claims would break the vesting design.

---

#### I-12

`Temporal` · On-chain: **Yes**

> Book fills (sell/borrow) only occur before series maturity.

**Derivation** — temporal: `StreamPricing.marketActive` reverts `SeriesMatured` when `block.timestamp >= expiryCached`; every book fill calls `_requireEligible` → `marketActive` first.

**If violated** — a matured stream (no discount window) could be mispriced.

---

#### I-13

`StateMachine` · On-chain: **Yes**

> An offer/listing deactivates one-shot: `active: true → false` on cancel or fill; no reactivate path.

**Derivation** — edge: `active = true` at every `post*`; set `false` in `cancel*` and on fill; no function sets it back to `true`. Duplicate-fill guarded by `require(... .active)`.

**If violated** — a consumed/cancelled order could be replayed.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **No**

> `OVRFLO.deposit` assumes `IPendleOracle.getPtToSyRate` returns a fresh, manipulation-resistant rate; oracle readiness is verified only at market onboarding, not at deposit.

**Caller side** — `OVRFLO.sol:344` consumes `rateE18 = IPendleOracle(oracle).getPtToSyRate(market, info.twapDurationFixed)` and uses it to mint `toUser`/`toStream` with no bounds/staleness check.

**Callee side** — `OVRFLOFactory.addMarket:155-159` is the only in-scope validation site (cardinality + oldest-observation satisfied); it runs once at onboarding. No in-scope code re-validates at deposit.

**If violated** — a stale or manipulated TWAP skews the immediate-vs-streamed split within a block.

---

#### X-2

On-chain: **No**

> `OVRFLOBook` loan servicing assumes Sablier `withdrawableAmountOf()` is monotonic and that `withdraw` ACL remains sender/owner/approved-only; the book relies on NFT custody to gate withdrawals.

**Caller side** — `OVRFLOBook.claimLoan:723` reads `sablier.withdrawableAmountOf(streamId)` and caps the draw at `_outstanding`; `closeLoan:741` requires `withdrawable >= outstanding`; both call `sablier.withdraw(streamId, lender, amount)`.

**Callee side** — `StreamPricing.requireEligible:148-160` validates at pledge that the stream is non-cancelable, sender=core, asset/end-time correct, and `remaining > 0`. No in-scope re-validation at claim/close. Sablier itself (v1.1, immutable `0xAFb979…`) is out of scope.

**If violated** — wrong withdrawable accounting or an ACL bypass could let a lender overdraw or a third party drain the escrowed stream.

---

#### X-3

On-chain: **Yes**

> `OVRFLOBook` immutables (`treasury`, `underlying`, `ovrfloToken`) equal the factory registry values for the served vault and never change.

**Caller side** — `OVRFLOBook.constructor:297-304` reads `IOVRFLOFactoryRegistry(factory).ovrfloInfo(core)` and stores the tuple as immutables.

**Callee side** — `OVRFLOFactory.deploy:131-137` is the only writer of `ovrfloInfo[ovrflo]`; no setter updates an existing entry. One-shot, no mutation.

**If violated** — the book would price/repay in a token mismatched with the vault.

---

#### X-4

On-chain: **Yes**

> `isMarketApproved[ovrflo][market]`, once set true by `addMarket`, is never unset (no unapprove path).

**Caller side** — `StreamPricing.marketActive:121` reads `isMarketApproved(core, market)` to gate offers.

**Callee side** — `OVRFLOFactory.addMarket:175` is the only writer; no `false` write exists. Deposit-limit=0 is the freeze mechanism, not an unapprove.

**If violated** — a frozen market could still accept book offers (offers only check market approval, not deposit limits); by design, but worth noting.

---

#### X-5

On-chain: **Yes**

> Every pledged/sold stream matches its series: Sablier sender = core vault, asset = series ovrfloToken, end time = cached expiry (fits uint40), no cliff, non-cancelable, `deposited > withdrawn`.

**Caller side** — `OVRFLOBook` fill paths call `_requireEligible` → `StreamPricing.requireEligible` before any pricing/transfer.

**Callee side** — `StreamPricing.requireEligible:142-160` reads the live Sablier stream state and the synthesized `series(market)`; all checks enforced at pledge/post time. The validated `remaining = deposited - withdrawn` is returned for pricing.

**If violated** — an off-spec stream (wrong asset, cancelable, wrong end) could be sold/borrowed against with incorrect collateral.

---

## 4. Economic Invariants

#### E-1

On-chain: **No**

> Every ovrfloToken in circulation is backed by either wrapped underlying, deposited PT, or unvested stream value: `totalSupply(ovrfloToken) <= wrappedUnderlying + Σ_market marketTotalDeposited[market] + streamedUndrawn`.

**Follows from** — `I-1` (PT backing per market) + `I-2` (wrap reserve backing) + the deposit split (`toUser` minted to user, `toStream` minted to vault then streamed). On-chain=**No** because I-1 is On-chain=No (exact-transfer gap).

**If violated** — ovrfloToken supply exceeds real backing; claims or unwraps fail for late holders.

---

#### E-2

On-chain: **Yes**

> For every loan, `obligation <= remaining` and `drawn + repaid <= obligation`, so the pledged stream can always cover the debt and `closeLoan` is eventually callable (liveness).

**Follows from** — `StreamPricing.obligationForFill` (full-borrow fast-paths to `remaining`; partial-borrow ceils and `borrowAmount <= grossPrice = floor(remaining/factor)` guarantees `obligation <= remaining`) + `I-10` (loan closed one-shot) + G-17 (repay <= outstanding) + G-18 (close requires coverage). Rounding directions are directional and load-bearing (floor price, ceil obligation).

**If violated** — a loan could become unrepayable or the lender overdraw past the stream, breaking the no-liquidation design.

---

#### E-3

On-chain: **Yes**

> ovrfloToken is fungible across all PT series of the same underlying; a holder may burn against any matured series with sufficient `claimablePt(ptToken)`, and `addMarket` enforces an exact underlying match so unrelated assets never share a token.

**Follows from** — `I-9` (series immutability) + `OVRFLOFactory.addMarket:164-166` (`IStandardizedYield(sy).yieldToken() == info.underlying`) + the shared vault-level `ovrfloToken` immutable. Per-market accounting (`marketTotalDeposited`, `claimablePt`) is tracked independently so claims are bounded per-market even though the token is shared.

**If violated** — cross-series claims could draw PT from the wrong market, or unrelated assets could share a wrapper token.
