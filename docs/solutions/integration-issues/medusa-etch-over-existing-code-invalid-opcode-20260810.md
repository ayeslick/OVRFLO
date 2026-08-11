---
title: Medusa dies on vm.etch over an address that already has code — deploy the harness as the market instead
date: 2026-08-10
category: integration-issues
module: test/fizz (Medusa/Echidna harness), test/fizz/harness
problem_type: integration_issue
component: fuzzing-harness
severity: high
applies_when:
  - A fuzz harness needs extra getters on a contract normally deployed by another contract (factory pattern)
  - vm.etch is used to overlay code onto a factory-deployed address
  - A suite passes under Foundry but fails chain initialization under Medusa
tags: [medusa, echidna, vm-etch, geth, revm, jumpdest, harness, fizz]
---

# Medusa dies on `vm.etch` over an address that already has code — deploy the harness as the market instead

## Context

The ticket-07 fizz harness needed raw tape getters (`fizz_epochState`, …) that
`OVRFLOLending`'s public surface does not expose. The original design deployed
the market through the real factory path, then `vm.etch`ed an
`OVRFLOLendingHarness` runtime (same constructor args, getters only) over the
factory-deployed address. All 337 Foundry tests passed. Medusa failed chain
initialization: the first call into the etched address died with
`invalid opcode: opcode 0x4f not defined` — a byte inside the selector
dispatch table's PUSH-data, i.e. a JUMP validated against a jump-destination
analysis belonging to different bytecode.

## Diagnosis

Within one failing trace, both behaviors were visible:

- `vm.etch` onto an **empty** address (the Sablier mock at its hardcoded
  constant address) worked — setup successfully called through it.
- `vm.etch` **over existing code** (the factory-deployed market) broke the
  first subsequent call, with a complete, valid, size-legal blob (24,120 B).

Consistent with Medusa's geth-backed EVM pairing the new code with the old
code's cached JUMPDEST analysis. Foundry's revm re-analyzes per call, which is
why no forge gate could ever catch this. (Upstream repro/report spun off
separately; the mechanism attribution is inferred, the observable divergence is
proven.)

## Fix (the shipped pattern)

Ban etch-over-existing-code in the fizz suite. `Base.setup()` now:
1. deploys `OVRFLOLendingHarness` directly **as** the market, with the exact
   constructor arguments `deployLending` would use (all immutables identical);
2. hands ownership to the factory (`transferOwnership` + pranked
   `acceptOwnership`), preserving the admin model and the admin-ACL properties;
3. replays `deployLending`'s four registry writes via `vm.store` (slots from
   `forge inspect OVRFLOFactory storageLayout`), so `_requireKnownLending`,
   the forwarders, and the registry-identity properties behave exactly as for
   a factory-deployed market.

Etching onto **empty** addresses (mock-at-constant-address) remains fine.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 1 (unrepresentable) **by removal**: the footgun call pattern was deleted
from the harness design, not tested around. The rule "never `vm.etch` over an
address that already has code in any Medusa-target suite" is enforced by the
absence of any such call; the harness NatSpec and `Base.setup()` comment carry
the rationale so a future "cleanup" doesn't reintroduce it.

## See also

- `test/fizz/Base.sol` step 7 comment; `test/fizz/harness/OVRFLOLendingHarness.sol` NatSpec.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` — candidate continuation pattern.
