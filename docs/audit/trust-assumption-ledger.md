# Trust Assumption / Pre-Flight Ledger

> Every belief OVRFLO asks the auditor to validate, in one place. Framed as an aviation-style pre-flight briefing: the items below are declared **known hazards to probe**, not surprises to discover. Mark each **ACCEPT** or **CHALLENGE** before reading code. Link derivations are in `x-ray/invariants.md` and `x-ray/x-ray.md`.

The highest-value audit targets are the items marked **On-chain: No** — these are where residual risk lives, because the protocol trusts them without enforcing them in code.

## Not-enforced-on-chain invariants (probe these first)

| ID | Belief | Enforced? | Failure mode | ACCEPT / CHALLENGE |
|----|-------|-----------|--------------|-------------------|
| **I-8** | `marketTotalDeposited[market] <= marketDepositLimits[market]` whenever the limit is non-zero | **On-chain: No.** Guard G-6 checks at deposit, but admin can lower `marketDepositLimits` below already-deposited principal via `setMarketDepositLimit`. | Admin sets a new limit below current deposited; the bound is not globally preserved. | ☐ |
| **I-6** | All *active* book orders always satisfy current APR bounds | **On-chain: No.** G-16 checks at order creation; `setAprBounds()` can move policy after orders are active without revalidating stored orders. | Active orders remain executable while outside the latest APR policy. | ☐ |
| **X-1** | `getPtToSyRate()` is fresh/quality at deposit time | **On-chain: No.** Oracle freshness/cardinality checked at onboarding only; not revalidated per deposit. | Stale/manipulated TWAP skews the `toUser`/`toStream` split and protocol fee (M-4). | ☐ |
| **X-2** | Sablier `withdrawableAmountOf()` and stream-transfer semantics stay stable | **On-chain: No.** External Sablier v1.1 behavior; out of local write control. | Closability and lender draw paths deviate from local bookkeeping. | ☐ |

## Off-chain-trusted token assumptions

| ID | Belief | Enforced? | Failure mode | ACCEPT / CHALLENGE |
|----|-------|-----------|--------------|-------------------|
| **audit-report I-1 (ex-M-1)** | `deposit()` receives exactly `ptAmount` of PT (exact transfer, no balance-delta check) | **Onboarding trust.** `deposit()` uses user-supplied `ptAmount`, unlike `wrap()`/`_pullExact()` which balance-delta check. Trusts canonical Pendle PT exact-transfer behavior. | Non-standard PT would make `marketTotalDeposited` diverge from received. Outside Pendle-only scope. | ☐ |
| **audit-report I-2 (ex-M-2)** | Underlying fee transfer in `deposit()` is exact | **Onboarding trust.** Fee computed on `toUser`, transferred without balance-delta verification. Same trust boundary as I-1 for canonical underlyings. | Fee-on-transfer underlying would under-pay treasury. Outside canonical-asset scope. | ☐ |

## Bounded-external actors

| Actor | Trust level | What OVRFLO trusts it for | Failure mode |
|-------|-------------|---------------------------|--------------|
| Pendle market + oracle (`getPtToSyRate`, `yieldToken`) | Bounded external | Rate/market metadata represent the intended PT/SY relationship; rate is a fresh TWAP | Stale/manipulated rate skews mint split (X-1); wrong `yieldToken` mismatches assets (prevented at onboarding, I-9) |
| Sablier V2 Lockup Linear v1.1 (`0xAFb979…`) | Bounded external | Stream NFT semantics, `withdrawableAmountOf`, withdraw ACL, non-cancelability | Behavior drift changes closability/eligibility (X-2); a permissionless withdraw path would drain escrow (verified absent in v1.1 — see H-2) |
| ERC20 PT/underlying tokens | Bounded external | Standard exact-transfer semantics on non-`_pullExact` paths | Fee-on-transfer/rebasing tokens break deposit/fee accounting (audit-report I-1/I-2); prevented by Pendle-only onboarding scope |

## Trust boundaries

| Boundary | What crosses it | Where enforced |
|----------|----------------|----------------|
| Multisig / Factory | Owner-gated factory calls are the sole admin ingress | `OVRFLOFactory` ownership; `onlyAdmin` (G-1) |
| Factory / Vault registry | `ovrfloInfo` + market approvals define canonical asset/market routing | `OVRFLOFactory.deploy()`, `OVRFLO.setSeriesApproved()` (one-shot, I-9) |
| Book / Stream | `StreamPricing.requireEligible()` gates all stream-collateral operations | `StreamPricing.requireEligible()` (X-5; enforced — probe for bypass/stale-cache) |
| Oracle / Valuation | Deposit split and financing obligations derive from oracle/time functions | `OVRFLO.deposit()`, `StreamPricing` (X-1 not revalidated per call) |

## Adversary ranking (from `x-ray/x-ray.md`)

1. **Oracle manipulator** — stale/misaligned TWAP propagates into settlement (X-1, M-4).
2. **Sophisticated stream trader / MEV actor** — boundary conditions in listing/offer execution, slippage, timing-sensitive maturity windows.
3. **Compromised admin key-holder** — market onboarding and critical configuration (I-8, I-6).
4. **External dependency behavior drift** — Sablier/Pendle operational changes (X-2).

Start the audit here, then work outward.
