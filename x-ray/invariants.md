# Invariant Map

> OVRFLO | 19 guards | 9 inferred + 5 cross-contract + 3 economic | 4 not enforced on-chain

---

## 1. Enforced Guards (Reference)

#### G-1
`require(msg.sender == adminContract, "OVRFLO: not admin")` · `src/OVRFLO.sol:180` · protects the factory-admin trust boundary for all series/deposit-limit/sweep writes.

#### G-2
`require(info.ptToken == address(0), "OVRFLO: series already configured")` · `src/OVRFLO.sol:226` · enforces one-time market configuration so PT/expiry/oracle wiring cannot be overwritten later.

#### G-3
`require(ptToMarket[pt] == address(0), "OVRFLO: PT already mapped")` · `src/OVRFLO.sol:227` · protects one-to-one PT-to-market routing.

#### G-4
`require(balanceAfter >= balanceBefore && balanceAfter - balanceBefore == amount, "OVRFLO: transfer amount mismatch")` · `src/OVRFLO.sol:295` · enforces exact-transfer semantics for wrap accounting.

#### G-5
`require(reserve >= amount, "OVRFLO: insufficient reserve")` · `src/OVRFLO.sol:312` · protects 1:1 unwrap solvency against reserve underflow.

#### G-6
`require(info.approved, "OVRFLO: market not approved")` · `src/OVRFLO.sol:336` · ensures deposits only use explicitly approved market metadata.

#### G-7
`require(ptAmount >= MIN_PT_AMOUNT, "OVRFLO: amount < min PT")` · `src/OVRFLO.sol:337` · prevents dust PT deposits that would destabilize stream/value math.

#### G-8
`require(block.timestamp < info.expiryCached, "OVRFLO: matured")` · `src/OVRFLO.sol:338` · blocks pre-maturity deposit path from extending value after expiry.

#### G-9
`require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded")` · `src/OVRFLO.sol:345` · caps incremental PT deposits when a market limit is active.

#### G-10
`require(toStream > 0, "OVRFLO: nothing to stream")` · `src/OVRFLO.sol:358` · enforces that deposit mints a non-zero streamed component.

#### G-11
`require(block.timestamp >= info.expiryCached, "OVRFLO: not matured")` · `src/OVRFLO.sol:398` · gates claims to post-maturity redemption only.

#### G-12
`require(currentDeposited >= amount, "OVRFLO: deposit accounting")` · `src/OVRFLO.sol:402` · prevents market deposit accounting underflow during claim.

#### G-13
`require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds")` · `src/OVRFLOBook.sol:697` · enforces APR band for new secondary-market order creation.

#### G-14
`require(balanceAfter >= balanceBefore && balanceAfter - balanceBefore == amount, "OVRFLOBook: transfer mismatch")` · `src/OVRFLOBook.sol:716` · enforces exact-transfer semantics for underlying escrow pulls.

#### G-15
`require(loan.borrower != address(0), "OVRFLOBook: unknown loan")` · `src/OVRFLOBook.sol:744` · ensures servicing functions operate only on initialized loans.

#### G-16
`require(amount <= outstanding, "OVRFLOBook: repay too much")` · `src/OVRFLOBook.sol:572` · caps repayment path to remaining obligation.

#### G-17
`require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high")` · `src/OVRFLOBook.sol:224` · globally bounds configurable book fee.

#### G-18
`require(IStandardizedYield(sy).yieldToken() == info.underlying, "OVRFLOFactory: underlying mismatch")` · `src/OVRFLOFactory.sol:165` · enforces exact underlying matching for new Pendle market onboarding.

#### G-19
`require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short")` · `src/OVRFLOFactory.sol:209` · protects oracle readiness flow from sub-minimum TWAP windows.

---

## 2. Inferred Invariants (Single-Contract)

#### I-1

`Conservation` · On-chain: **Yes**

> `marketTotalDeposited[market]` tracks net PT principal per market: +`ptAmount` on `deposit()` and -`amount` on `claim()`.

**Derivation** — `Δ-pair: src/OVRFLO.sol:347 ↔ src/OVRFLO.sol:403` with no other writer to `marketTotalDeposited`.

**If violated** — claimability/accounting diverges from actual vault PT balances.

---

#### I-2

`Bound` · On-chain: **No**

> Global property candidate: `marketTotalDeposited[market] <= marketDepositLimits[market]` whenever limit is non-zero.

**Derivation** — `guard-lift: require(currentDeposited + ptAmount <= limit)` at `src/OVRFLO.sol:345`; write-site enumeration shows unguarded `marketDepositLimits[market] = limit` at `src/OVRFLO.sol:249` can lower limit below current deposited.

**If violated** — admin can set a new limit below already deposited principal, so the bound is not globally preserved.

---

#### I-3

`Conservation` · On-chain: **Yes**

> `wrappedUnderlying` is a reserve ledger: +`amount` on `wrap()`, -`amount` on `unwrap()`.

**Derivation** — `Δ-pair: src/OVRFLO.sol:299 ↔ src/OVRFLO.sol:314`; sweep path computes excess against reserve and does not mutate reserve (`src/OVRFLO.sol:270-279`).

**If violated** — unwrap availability and actual underlying reserve drift apart.

---

#### I-4

`StateMachine` · On-chain: **Yes**

> Series configuration and PT reverse mapping are one-shot latches per market/PT.

**Derivation** — `edge: address(0)@src/OVRFLO.sol:226 → pt@src/OVRFLO.sol:233` and `address(0)@src/OVRFLO.sol:227 → market@src/OVRFLO.sol:238` with no reset path.

**If violated** — market identity/expiry/oracle immutability for outstanding deposits is broken.

---

#### I-5

`Bound` · On-chain: **Yes**

> `feeBps` in `OVRFLOBook` stays in `[0, MAX_FEE_BPS]`.

**Derivation** — `guard-lift: require(feeBps_ <= MAX_FEE_BPS)` at `src/OVRFLOBook.sol:224`; all writes to `feeBps` occur in `setFee()` (`src/OVRFLOBook.sol:226`).

**If violated** — fee extraction can exceed configured policy envelope.

---

#### I-6

`Bound` · On-chain: **Yes**

> Newly created book orders have APR within current `[aprMinBps, aprMaxBps]`.

**Derivation** — `guard-lift: require(aprBps >= aprMinBps && aprBps <= aprMaxBps)` at `src/OVRFLOBook.sol:697`; all order creation sites call `_validateApr()` (`src/OVRFLOBook.sol:248,309,374,448`).

**If violated** — order intake could accept out-of-policy financing terms.

---

#### I-7

`Bound` · On-chain: **No**

> Global property candidate: all *active* book orders always satisfy current APR bounds.

**Derivation** — `guard-lift` above applies only at creation; write-site enumeration shows admin can later shift bounds via `setAprBounds()` (`src/OVRFLOBook.sol:217-218`) without revalidating stored orders.

**If violated** — active orders can remain executable while outside the latest APR policy.

---

#### I-8

`Ratio` · On-chain: **Yes**

> Loan outstanding is strictly `obligation - (drawn + repaid)`.

**Derivation** — formula source `src/OVRFLOBook.sol:747-753`; writes: `drawn += amount` (`src/OVRFLOBook.sol:538,555`) and `repaid += amount` (`src/OVRFLOBook.sol:574`) are guarded by outstanding checks.

**If violated** — lender/borrower settlement symmetry breaks across claim, repay, and close paths.

---

#### I-9

`StateMachine` · On-chain: **Yes**

> Offer/listing active flags are one-way toggles from `true` to `false` for each ID.

**Derivation** — `edge: true@creation (src/OVRFLOBook.sol:253,323,379,468) → false@consume/cancel (src/OVRFLOBook.sol:267,290,333,353,393,425,478,505)` with no reactivation write.

**If violated** — consumed or canceled orders could be replayed.

---

## 3. Inferred Invariants (Cross-Contract)

#### X-1

On-chain: **Yes**

> `OVRFLOBook` only prices/trades streams that belong to the expected core/market/token tuple.

**Caller side** — `src/OVRFLOBook.sol:278,343,409,451,492,597` route through `_requireEligible()`.

**Callee side** — `src/StreamPricing.sol:98-111` validates core registration, market approval, series approval, stream sender, stream asset, end time, no cliff, non-cancelable.

**If violated** — arbitrary streams could be sold/financed against incorrect collateral context.

---

#### X-2

On-chain: **No**

> `OVRFLO.deposit()` assumes oracle rate quality for immediate minting split.

**Caller side** — `src/OVRFLO.sol:352-356` consumes `getPtToSyRate()` and mints `toUser`/`toStream`.

**Callee side** — oracle freshness/cardinality is only pre-checked at onboarding (`src/OVRFLOFactory.sol:154-157`), not revalidated inside deposit path.

**If violated** — short-horizon oracle anomalies can skew immediate-vs-streamed value split.

---

#### X-3

On-chain: **Yes**

> Wrap/unwrap asset identity for a vault is anchored to factory registry wiring.

**Caller side** — `src/OVRFLO.sol:290-317` loads `(underlying, ovrfloToken)` from `ovrfloInfo(address(this))`.

**Callee side** — `src/OVRFLOFactory.sol:127-128` writes registry once at deploy; no subsequent writer mutates existing `ovrfloInfo[ovrflo]`.

**If violated** — unwrap reserve accounting could be applied to the wrong token pair.

---

#### X-4

On-chain: **Yes**

> Factory-listed markets must match vault underlying at Pendle SY layer.

**Caller side** — `src/OVRFLOFactory.sol:164-166` checks `IStandardizedYield(sy).yieldToken() == info.underlying`.

**Callee side** — `src/OVRFLO.sol:229-236` stores the validated underlying into immutable per-series routing used by deposits.

**If violated** — mismatched markets could route fees/principal across incompatible assets.

---

#### X-5

On-chain: **No**

> Loan servicing assumes Sablier `withdrawableAmountOf()` and stream transfer semantics remain stable.

**Caller side** — `src/OVRFLOBook.sol:535-559` uses Sablier withdrawability to gate claim/close transitions.

**Callee side** — external Sablier contract state/logic is out of local scope and may evolve operationally despite fixed integration surface.

**If violated** — closability and lender draw paths can deviate from local bookkeeping assumptions.

---

## 4. Economic Invariants

#### E-1

On-chain: **Yes**

> Every cash settlement path conserves quote currency: `gross = net + fee`.

**Follows from** — `I-5` + settlement writes at `src/OVRFLOBook.sol:284-286`, `src/OVRFLOBook.sol:350-352`, `src/OVRFLOBook.sol:502-503`.

**If violated** — fee leakage or hidden value transfer appears in book settlements.

---

#### E-2

On-chain: **Yes**

> Lender extractable value per loan is capped by recorded obligation.

**Follows from** — `I-8` + `X-1`.

**If violated** — lender can overdraw stream value beyond negotiated loan terms.

---

#### E-3

On-chain: **Yes**

> 1:1 wrap/unwrap liquidity remains solvent while reserve accounting and registry wiring hold.

**Follows from** — `I-3` + `X-3`.

**If violated** — wrappers can face redeemability gaps despite nominal token balances.
