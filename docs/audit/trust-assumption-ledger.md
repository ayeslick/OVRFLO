# Trust Assumption / Pre-Flight Ledger

> Every belief OVRFLO asks the auditor to validate, in one place. Framed as an aviation-style pre-flight briefing: the items below are declared **known hazards to probe**, not surprises to discover. Mark each **ACCEPT** or **CHALLENGE** before reading code. Link derivations are in `x-ray/invariants.md` and `x-ray/x-ray.md`.

The highest-value audit targets are the items marked **On-chain: No** — these are where residual risk lives, because the protocol trusts them without enforcing them in code.

## Not-enforced-on-chain invariants (probe these first)

| ID | Belief | Enforced? | Failure mode | ACCEPT / CHALLENGE |
|----|-------|-----------|--------------|-------------------|
| **I-6** | `marketTotalDeposited[market] <= marketDepositLimits[market]` whenever the limit is non-zero | **On-chain: No.** Guard G-7 checks at deposit, but admin can lower `marketDepositLimits` below already-deposited principal via `setMarketDepositLimit`. | Admin sets a new limit below current deposited; the bound is not globally preserved. | ☐ |
| **X-4** | `setMarketDepositLimit` does not check `limit >= marketTotalDeposited[market]` | **On-chain: No.** The setter writes the limit with no guard against existing deposits; I-6 is broken as a side effect. | Same as I-6 — cross-contract perspective (factory forwards the call, vault writes the value). | ☐ |
| **X-1** | `getPtToSyRate()` is fresh/quality at deposit time | **On-chain: No.** Oracle freshness/cardinality checked at onboarding only; not revalidated per deposit. Low practical risk: Pendle is a live protocol with external traders/LPs whose activity writes oracle observations continuously. OVRFLO is not the sole AMM user. Worst case, a keeper bot can touch the market via `OVRFLOFactory.prepareOracle()` to maintain freshness. | Stale/manipulated TWAP skews the `toUser`/`toStream` split and protocol fee (M-4). | ☐ |

## Bounded-external actors

| Actor | Trust level | What OVRFLO trusts it for | Failure mode |
|-------|-------------|---------------------------|--------------|
| Pendle market + oracle (`getPtToSyRate`, `yieldToken`) | Bounded external | Rate/market metadata represent the intended PT/SY relationship; rate is a fresh TWAP | Stale/manipulated rate skews mint split (X-1); wrong `yieldToken` mismatches assets (prevented at onboarding, I-9). Low staleness risk: external Pendle activity keeps observations fresh; keeper bot via `prepareOracle()` as fallback |
| Sablier V2 Lockup Linear v1.1 (`0xAFb979…`) | Bounded external | Stream NFT semantics, `withdrawableAmountOf`, withdraw ACL, non-cancelability | Behavior drift changes closability/eligibility; a permissionless withdraw path would drain escrow (verified absent in v1.1 — see H-2) |
| ERC20 PT/underlying tokens | Bounded external | Standard 18-decimal exact-transfer semantics | Non-standard tokens (fee-on-transfer, rebasing, non-18-decimal) are explicitly out of scope — the multisig validates canonical Pendle markets at `addMarket()` |

## Trust boundaries

| Boundary | What crosses it | Where enforced |
|----------|----------------|----------------|
| Multisig / Factory | Owner-gated factory calls are the sole admin ingress | `OVRFLOFactory` ownership; `onlyAdmin` (G-1) |
| Factory / Vault registry | `ovrfloInfo` + market approvals define canonical asset/market routing | `OVRFLOFactory.deploy()`, `OVRFLO.setSeriesApproved()` (one-shot, I-9) |
| Book / Stream | `StreamPricing.requireEligible()` gates all stream-collateral operations | `StreamPricing.requireEligible()` (enforced via X-1 — probe for bypass/stale-cache) |
| Oracle / Valuation | Deposit split and financing obligations derive from oracle/time functions | `OVRFLO.deposit()`, `StreamPricing` (X-1 not revalidated per call) |

## Adversary ranking (from `x-ray/x-ray.md`)

1. **Oracle manipulator / flash loan attacker** — stale/misaligned TWAP propagates into settlement (X-1, M-4); flash loan capital can move Pendle prices within a single tx. Low staleness risk in practice: external Pendle activity keeps observations fresh; keeper bot via `prepareOracle()` as fallback.
2. **Pool claim accounting attacker** — dual claim channels (poolClaimLoan + claimPoolShare) share a single entitlement cap; interactions deserve scrutiny (I-14, I-15, I-16).
3. **Compromised admin key-holder** — market onboarding and critical configuration (I-6, X-4); all operational powers are instant (no on-chain timelock).
4. **Order book griefing attacker** — can post and cancel offers/listings to lock liquidity or front-run other traders.

Start the audit here, then work outward.
