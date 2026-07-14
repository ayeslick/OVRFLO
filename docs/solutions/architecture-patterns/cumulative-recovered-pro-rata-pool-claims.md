---
title: Cumulative-recovered pro-rata pool claims
date: 2026-07-13
category: docs/solutions/architecture-patterns/
module: OVRFLOLending (pool claims)
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Designing pro-rata claim distributions from a shared loan pool"
  - "Implementing cumulative-recovered accounting that includes open loan streams"
  - "Adding _claimFair helpers that draw from escrowed Sablier streams"
  - "Reviewing pool claim fairness for FCFS-drainage vulnerabilities"
tags: [pro-rata, pool-claims, fcfs-drainage, cumulative-recovered, claim-fair, lending]
---

# Cumulative-recovered pro-rata pool claims

## Context

OVRFLOLending's `claimLoanPoolShare` function used a first-come-first-served (FCFS) approach where lenders could claim from `loanPoolProceeds` without a pro-rata cap. Early claimants could drain more than their fair share, leaving later claimants with nothing even though they contributed equally. Additionally, `_claimFair` computed `recovered = drawn + repaid` which didn't account for the stream's withdrawable amount on open loans, understating the true recoverable value.

## Guidance

The fix replaced FCFS with a cumulative-recovered formula:

```solidity
uint256 recovered = uint256(loan.drawn) + uint256(loan.repaid);
if (!loan.closed) {
    recovered += uint256(_minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan)));
}
uint256 claimable = uint256(contribution) * recovered / uint256(loanPools[loanPoolId].totalContributed)
    - loanPoolReceived[loanPoolId][account];
```

For open loans, `recovered` includes `min(withdrawable, outstanding)` — the stream's not-yet-drawn accrual. For closed loans, `recovered = drawn + repaid` (outstanding is 0, stream returned). The `loanPoolReceived` mapping tracks cumulative per-lender receipts, so `claimable` is the delta between pro-rata entitlement and what's already been received. When `loanPoolProceeds` is insufficient for an open loan, the function harvests the deficit from the stream via `sablier.withdraw`.

The old `poolClaimLoan` function was removed entirely as it was vestigial — `claimLoanPoolShare` subsumed its functionality. `_requireLoanExists` was added to `_claimFair` for safety.

## Why This Matters

Without pro-rata caps, a pool with two equal contributors could see the first claimant extract 100% of available proceeds, leaving the second with nothing. The cumulative-recovered formula ensures every lender can claim up to their pro-rata share of total recovery, regardless of claim order.

## When to Apply

- When designing shared-pool claim mechanisms where multiple contributors have proportional entitlements
- Particularly relevant for self-repaying loan protocols where recovery accrues over time from stream draws
- When reviewing FCFS claim patterns for drainage vulnerabilities

## Examples

Before (FCFS - unfair):
```
Pool: totalContributed=100, lender A contributed 50, lender B contributed 50
Proceeds accumulate to 80. Lender A claims 80 (all of it). Lender B claims 0.
```

After (cumulative-recovered - fair):
```
Pool: totalContributed=100, lender A contributed 50, lender B contributed 50
recovered=80, claimable_A = 50*80/100 - 0 = 40, claimable_B = 50*80/100 - 0 = 40
Lender A claims 40, Lender B claims 40. Each gets their pro-rata share.
```

## Related

- [Solidity batch function safety patterns](../design-patterns/solidity-batch-function-safety-patterns.md) - Section 2 documents the prior FCFS approach this replaces; needs refresh
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) - Pattern #12 codifies the FCFS stance that this learning supersedes; needs rewrite
- [Triage fix and document audit findings](../best-practices/triage-fix-and-document-audit-findings.md) - M-01 documents the prior pro-rata cap removal; this is the next iteration
- [Pool-only lending consolidation](./ovrflobook-pool-only-lending-consolidation.md) - Documents the pool architecture this formula operates within
