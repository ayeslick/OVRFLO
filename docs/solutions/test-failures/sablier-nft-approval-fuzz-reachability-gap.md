---
title: Sablier NFT setApprovalForAll fuzz reachability gap
date: 2026-07-13
category: docs/solutions/test-failures/
module: Fizz fuzz harness (Base.setupActors)
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "All 147/147 Medusa fuzz passes were largely vacuous for lending paths"
  - "Stream-custody transitions (createBorrowerLoanPool, closeLoan via sablier.transferFrom) reverted silently in the harness"
  - "LCOV coverage of OVRFLOLending.sol stuck at 66.3% (203/306 lines)"
root_cause: incomplete_setup
resolution_type: test_fix
tags: [fuzz, medusa, fizz, sablier, nft-approval, setapprovalforall, coverage, reachability, vacuous-passes]
---

# Sablier NFT setApprovalForAll fuzz reachability gap

## Problem

The Fizz fuzz harness's `Base.setupActors()` function granted ERC20 approvals for ovrfloToken but never called `MockSablier.setApprovalForAll(address(lending), true)`. After the MockSablier ACL was tightened to require explicit approval for NFT transfers, all stream-custody transitions in the fuzz harness reverted silently. This meant `createBorrowerLoanPool` (which calls `sablier.transferFrom` to escrow the stream) and `closeLoan` (which calls `sablier.transferFrom` to return the stream) could never execute successfully.

## Symptoms

- 147/147 Medusa tests passed, 0 failed — appeared healthy
- LCOV coverage for OVRFLOLending.sol was only 66.3% (203/306 lines)
- Lending-specific handlers (createBorrowerLoanPool, closeLoan, claimLoanPoolShare) had near-zero successful invocations
- No property violations were triggered because the code paths that would violate them were never reached

## What Didn't Work

- Initially assumed the 147/147 pass rate meant the protocol was well-tested
- Coverage report was the key signal — 66.3% on the core lending contract indicated large sections of code were never executed
- The Medusa call distribution table showed very few successful closeLoan/createBorrowerLoanPool calls compared to other handlers

## Solution

Added one line to `setupActors()` in `test/fizz/Base.sol`:

```solidity
// Before (missing NFT approval):
for (uint256 i = 0; i < actors.length; i++) {
    vm.startPrank(actors[i]);
    ovrfloToken.approve(address(lending), type(uint256).max);
    vm.stopPrank();
}

// After (with NFT approval):
for (uint256 i = 0; i < actors.length; i++) {
    vm.startPrank(actors[i]);
    ovrfloToken.approve(address(lending), type(uint256).max);
    MockSablier(SABLIER_ADDR).setApprovalForAll(address(lending), true);
    vm.stopPrank();
}
```

After this fix, coverage jumped from 66.3% (203/306 lines) to 91.8% (281/306 lines), and the first real property violation (GL-70) surfaced.

## Why This Works

Sablier V2 streams are ERC-721 NFTs. Transferring custody (escrowing a stream as collateral, returning it after loan close) requires `transferFrom`, which in turn requires either `approve` (per-token) or `setApprovalForAll` (per-operator). ERC20 `approve` covers token transfers but NOT NFT transfers. The MockSablier's ACL tightening made this explicit — without `setApprovalForAll`, the lending contract couldn't take or return stream NFTs, silently reverting every custody transition.

## Prevention

- When setting up fuzz harnesses for protocols that interact with NFTs (ERC-721), always include `setApprovalForAll` in actor setup alongside ERC20 approvals
- Use LCOV coverage as a signal for vacuous passes — a high pass rate with low coverage on the target contract means the harness isn't reaching the interesting code paths
- Check the Medusa/Foundry call distribution table for handler success rates — if critical handlers have near-zero successes, the harness setup is broken
- The 147/147 pass rate was a false positive signal; coverage was the true indicator

## Related Issues

- [Closing stateful fuzz coverage gaps](../best-practices/closing-stateful-fuzz-coverage-gaps.md) - Direct predecessor documenting the same campaign; this is the 13th gap in that series
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) - Pattern #1 addresses Sablier NFT ownership/transfer semantics
