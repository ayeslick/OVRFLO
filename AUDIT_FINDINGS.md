# OVRFLO `src/*.sol` Audit Findings

## Scope

- Source reviewed: `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `src/OVRFLOBook.sol`, `src/OVRFLOToken.sol`, `src/StreamPricing.sol`
- Starting point: `AUDIT.md` and linked audit package.
- Baseline exclusions honored: non-standard ERC20 assumptions, Sablier V2 v1.1 withdraw ACL, cross-market ovrfloToken fungibility, permissionless `closeLoan`, and known admin trust boundaries unless new source-level evidence was found.

## Audit Plan Used

1. Read the prescribed onboarding docs and trust ledger, then map each permissionless value-moving entry point to its accounting state.
2. Review vault solvency paths (`deposit`, `claim`, `wrap`, `unwrap`, `flashLoan`, sweeps) against I-1/E-1 and known rejected findings.
3. Review OVRFLOBook sale, loan, pool, and claim flows against I-2/I-3/I-4/I-7/E-2/E-3.
4. Review `StreamPricing` rounding and each caller's slippage/fee checks.
5. Deduplicate against `docs/audit/rejected-findings-record.md` and record only confirmed findings or clearly labeled known/open issues.

## Findings

### M-01: `claimPoolShare` can strand pool proceeds and force repeated under-claims — FIXED

- **Severity:** Medium
- **Status:** Fixed (commit `f3abf8c`). Removed the pro-rata cap entirely; claims now capped by `min(remaining, poolProceeds)`. `poolReceived` prevents over-claiming. Minority contributors are no longer stranded.
- **Affected contract + entry point:** `OVRFLOBook.claimPoolShare()`
- **Related code:** `src/OVRFLOBook.sol:648-667`
- **Violated / challenged invariants:** I-3, I-4, E-3, G-35
- **Baseline-diff:** New issue. It challenges pattern #12's current-pot pro-rata cap; it is not the rejected permissionless `closeLoan` or Sablier ACL issue.

#### Root cause

`claimPoolShare()` computes a contributor's available amount from the *current shrinking* `poolProceeds[poolId]`, then subtracts the claim from that same pot:

```solidity
uint256 proRataShare =
    uint256(poolProceeds[poolId]) * poolContributions[poolId][msg.sender] / pools[poolId].totalContributed;
...
poolReceived[poolId][msg.sender] += amount;
poolProceeds[poolId] -= amount;
```

This caps every later claimant against a smaller pot than the one used for earlier claimants.

#### Impact

After `closeLoan()` or `repayLoan()` moves ovrfloToken into `poolProceeds`, a large contributor can claim their full entitlement first, leaving minority contributors only able to claim a fraction of their entitlement per transaction. In small-value or dust cases, positive proceeds can become permanently unclaimable when the pro-rata calculation floors to zero.

Example with `totalContributed = 100`, A contributing `99`, B contributing `1`, and `poolProceeds = 100`:

1. A claims `99`, leaving `poolProceeds = 1`.
2. B's available share is `1 * 1 / 100 = 0`.
3. B cannot claim any positive amount, while `poolProceeds` remains stuck.

With larger token amounts, the same shrinking-pot formula forces repeated geometric claims and leaves final dust unclaimable.

#### Recommendation

Track cumulative proceeds and per-contributor proceeds claimed separately. Compute proceeds claimable from cumulative accrual, then cap by the contributor's remaining total entitlement and the current pot:

```solidity
claimable =
    cumulativePoolProceeds[poolId] * contribution / totalContributed
    - poolProceedsClaimed[poolId][msg.sender];
claimable = min(claimable, entitlement - poolReceived[poolId][msg.sender]);
claimable = min(claimable, poolProceeds[poolId]);
```

Then increment both `poolProceedsClaimed` and `poolReceived` when paying.

### M-02: `createBorrowPool` slippage checks principal before fees, not net borrower proceeds — FIXED

- **Severity:** Medium
- **Status:** Fixed (commit `0f0ff7b`). Slippage check moved after fee computation; now checks `netToBorrower >= minAcceptable` instead of `actualBorrow >= minAcceptable`.
- **Affected contract + entry point:** `OVRFLOBook.createBorrowPool()`
- **Related code:** `src/OVRFLOBook.sol:571-581`
- **Violated / challenged invariants:** I-14, E-2 user settlement expectation
- **Baseline-diff:** New issue. This does not dispute the rejected 100% fee circuit-breaker decision; it identifies that this taker-side slippage parameter does not protect the amount actually received.

#### Root cause

`minAcceptable` is checked against `actualBorrow` before protocol fees are deducted:

```solidity
uint256 actualBorrow = targetBorrow < totalAvailable ? uint256(targetBorrow) : totalAvailable;
require(actualBorrow >= minAcceptable, "OVRFLOBook: insufficient capacity");
...
feeAmount = StreamPricing.fee(actualBorrow, feeBps);
netToBorrower = actualBorrow - feeAmount;
```

The borrower is paid `netToBorrower`, not `actualBorrow`.

#### Impact

A borrower can submit a transaction expecting at least `minAcceptable` underlying, but receive less if `feeBps` changes before execution. At the maximum allowed fee, `actualBorrow = minAcceptable = 100` passes while `netToBorrower = 0`, and the borrower still pledges the stream and owes the obligation.

`sellIntoOffer()` protects sellers with `minNetOut`; `createBorrowPool()` should provide equivalent net-output protection.

#### Recommendation

Either change the existing guard to net proceeds:

```solidity
require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage");
```

or add a separate `minNetToBorrower` parameter and keep `minAcceptable` as a principal/capacity guard.

### M-03: Pendle oracle freshness is confirmed at onboarding but not rechecked when value is settled — FIXED

- **Severity:** Medium, known/open
- **Status:** Fixed (commit `bdd752b`). Added `_requireOracleFresh` helper that calls `getOracleState` and checks `oldestObservationSatisfied` before `getPtToSyRate` in both `deposit` and `flashLoan`.
- **Affected contract + entry point:** `OVRFLO.deposit()`, `OVRFLO.flashLoan()`
- **Related code:** `src/OVRFLO.sol:377`, `src/OVRFLO.sol:457`, `src/OVRFLOFactory.sol:196-201`
- **Violated / challenged invariants:** X-1
- **Baseline-diff:** Previously documented as open M-4 / X-1 in the audit package; confirmed in current source.

#### Root cause

`OVRFLOFactory.addMarket()` checks `getOracleState()` once, but `deposit()` and `flashLoan()` later consume `getPtToSyRate()` directly without revalidating freshness/cardinality:

```solidity
uint256 rateE18 = IPendleOracle(oracle).getPtToSyRate(market, info.twapDurationFixed);
```

#### Impact

If a Pendle market's TWAP becomes stale or poor-quality after onboarding, deposits can receive a skewed `toUser` / `toStream` split and fee basis. Flash loan fees can also be undercharged if the rate is stale/depressed.

#### Recommendation

Add a lightweight oracle-state freshness check before live settlement paths, or explicitly operationalize and monitor this as a keeper-maintained trust assumption.

## Low / Informational Findings

### L-01: `quote` can return previews for APRs and zero-price cases that state-changing paths reject — FIXED

- **Severity:** Low
- **Status:** Fixed (commit `b35f83a`). Added `_validateApr(aprBps)` and `require(grossPrice > 0, "OVRFLOBook: price zero")` to `quote()`.
- **Affected contract + entry point:** `OVRFLOBook.quote()`
- **Related code:** `src/OVRFLOBook.sol:690-709`
- **Baseline-diff:** New low-severity integrator-safety issue.

`quote()` does not call `_validateApr(aprBps)` and does not mirror the `grossPrice > 0` checks used by `sellIntoOffer()`, `buyListing()`, and `createBorrowPool()`. Integrators can display quotes for APRs that cannot be posted, or for zero-price states that cannot be filled.

**Recommendation:** call `_validateApr(aprBps)` inside `quote()` and mirror the state-changing `grossPrice > 0` guard.

### L-02: `setAprBounds` can configure bounds containing no valid APR step — FIXED

- **Severity:** Low
- **Status:** Fixed (commit `5af9db9`). Both `aprMinBps_` and `aprMaxBps_` must be multiples of `APR_STEP_BPS` (100 bps).
- **Affected contract + entry point:** `OVRFLOBook.setAprBounds()`
- **Related code:** `src/OVRFLOBook.sol:274-282`, `src/OVRFLOBook.sol:868-871`
- **Baseline-diff:** New admin footgun; no direct fund-loss path.

`setAprBounds(1, 99)` passes because `aprMinBps <= aprMaxBps <= APR_MAX_CEILING`, but `_validateApr()` requires `aprBps % 100 == 0`, so no new offer or listing can be posted.

**Recommendation:** require the configured range to contain at least one `APR_STEP_BPS` multiple, or require both bounds to be step-aligned.

## Reviewed Leads Not Raised as Findings

- **Vault reentrancy without `nonReentrant` on `deposit` / `wrap` / `unwrap` / `claim`:** already rejected as CR-L1; current source follows CEI for canonical non-hooking tokens.
- **Unchecked `uint128(toStream)` / `uint40(duration)` in `OVRFLO.deposit()`:** documented inconsistently as active L-1 and rejected R-03; no new reachability evidence beyond the existing defense-in-depth note.
- **Book cached immutables X-2:** no scoped source path mutates `ovrfloInfo` after deployment, and factory deployment wires the tuple from the same deployment config.
- **Permissionless `closeLoan()`:** confirmed as intentional liveness and not a value-misrouting path.
