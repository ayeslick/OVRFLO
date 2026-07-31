---
title: Checkpoint tests must prove exactly-once emission and the fail-closed matrix
date: 2026-07-31
category: test-failures
module: test/OVRFLOLending.t.sol, src/OVRFLOLending.sol
problem_type: test_failure
component: testing_framework
symptoms:
  - "Checkpoint unit tests did not prove exactly-once emission"
  - "Retired-APR listing rejection and fail-closed checkpoint branches lacked coverage"
  - "Generated web ABI omitted the new public lending liquidity surface"
root_cause: incomplete_setup
resolution_type: test_fix
severity: medium
tags: [checkpoint, liquidity-depth, foundry, abi, exactly-once, ovrflolending]
related_components: [OVRFLOLending]
---

# Checkpoint tests must prove exactly-once emission and the fail-closed matrix

## Problem

U2 review found the new liquidity-depth / checkpoint work shipped with test
gaps: exactly-once emission was asserted weakly, retired-APR rejection and
fail-closed branches were incomplete, and the generated frontend ABI lagged the
new public surface.

## Symptoms

- Checkpoint reasons hard-coded as magic numbers instead of
  `LIQUIDITY_REASON_V1_*` getters
- Missing coverage for retired-APR listing rejection and fail-closed checkpoint
  branches
- Web consumers could not type against newly exported lending views until ABI
  regen

## What Didn't Work

Treating "happy-path supply emits a checkpoint" as enough. Replay safety and
fail-closed branches are the product of the feature.

## Solution

Expanded Foundry coverage to use named reason constants, assert exactly-once
emission, cover retired-APR and fail-closed branches, and regenerate the web
ABI from the updated contract surface (applied in worktree `5042` before
PR #3).

## Why This Works

Checkpoints are an on-chain discovery authority. Tests that only prove "an
event exists" miss the replay and rejection properties discovery depends on.

## Prevention

- Prefer contract-exported reason constants over literal `1/2/3/4` in tests
- Whenever lending's public surface changes, regenerate web ABIs in the same
  change

## Related Issues

- [Closing stateful fuzz coverage gaps](../best-practices/closing-stateful-fuzz-coverage-gaps.md)
- Captured from Codex U2 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
