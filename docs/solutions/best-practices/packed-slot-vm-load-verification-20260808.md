---
title: Proving storage-write claims with vm.load + forge inspect — the packed-slot verification technique
date: 2026-08-08
category: best-practices
module: test/ (storage-shape assertions), src/OVRFLOLending.sol (Epoch packing)
problem_type: best_practice
component: test-integrity
severity: medium
applies_when:
  - A plan or review pins a storage-shape claim ("one SSTORE", "these fields share a slot")
  - Verifying struct packing without assembly in production code
  - A gas argument depends on write coalescing
tags: [storage-packing, vm-load, forge-inspect, sstore, verification]
---

# Proving storage-write claims with `vm.load` + `forge inspect` — the packed-slot verification technique

## Context

The v1-lite plan pinned "one SSTORE" for the fill hot path: `Epoch.filled` and
its neighbors are packed so `_fillTick`'s bookkeeping coalesces into a single
storage write. The builder implemented it as two same-slot field assignments
(no assembly — banned) and needed to PROVE the claim rather than assert it.

## The technique

1. `forge inspect <Contract> storageLayout` gives authoritative slot/offset
   assignments — the ground truth for which fields share a slot. (The same
   command later supplied the factory registry slots for the fizz harness's
   `vm.store` deployment pattern — it is the general tool for any "which slot
   is this really in" question.)
2. A test computes the mapping slot by hand (`keccak256(key . slot)` chain),
   reads it with `vm.load` before and after the operation, and asserts the
   packed fields moved together in one word. This proves the PACKING; solc's
   optimizer coalesces same-slot writes, which the review then verified at the
   opcode level against a minimal compiled mirror of the two-assignment shape.
3. The result: a plan-pinned gas/storage claim held by an executable test plus
   a recorded one-time opcode check — not by trusting a comment.

The boundary worth respecting: `vm.load` assertions are for claims about
STORAGE SHAPE (packing, slot identity, single-word movement). Claims about
VALUES belong in ordinary getter-based assertions — reaching for raw slots
where a getter exists just makes the test brittle against layout refactors.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 3 (detected): the packing test fails if a refactor splits the slot. The
underlying claim cannot be made unrepresentable in Solidity (struct layout is
convention, not type-enforced), so tier 3 with an exact, mechanical check is
the ceiling — which is the required justification for its placement.

## See also

- `docs/solutions/best-practices/uncheatable-test-discipline-20260810.md` (hand-derived literals).
