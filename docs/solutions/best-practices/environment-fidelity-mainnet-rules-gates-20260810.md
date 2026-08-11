---
title: Only mainnet-rules environments catch mainnet-rules bugs — the factory size blocker slipped every gate
date: 2026-08-10
category: best-practices
module: src/OVRFLOFactory.sol, script/seed-local.sh, verification gates
problem_type: best_practice
component: verification-pipeline
severity: critical
applies_when:
  - Declaring a contract "verified" from build/test/fuzz gates alone
  - A contract grows near the EIP-170 (24,576 B runtime) or EIP-3860 (49,152 B initcode) caps
  - Designing which gates belong in the Verification Contract
tags: [eip-170, eip-3860, code-size, anvil, foundry, medusa, verification-contract, deployability]
---

# Only mainnet-rules environments catch mainnet-rules bugs — the factory size blocker slipped every gate

## Context

Ticket 08's seed smoke (the first Anvil mainnet-fork run after the v1-lite
rewrite) failed at step 1: `max initcode size exceeded` deploying
`OVRFLOFactory`. Measurement: initcode 50,609 B (> EIP-3860's 49,152) and
runtime 50,122 B (> 2× EIP-170's 24,576). The factory embeds the creation code
of all three children it `new`s; the lending rewrite (23,448 B runtime) pushed
the total over. **The factory is undeployable under mainnet rules** — a
product-level blocker discovered only at the seed smoke.

## Why every earlier gate was blind

- `forge build` compiles oversized contracts without failing (size is a table
  in `--sizes`, not an error by default).
- Foundry tests (revm) do not enforce deploy-size caps in the test
  environment — 337 tests deployed the factory thousands of times.
- Medusa's chain accepted the oversized deployments too.
- Only Anvil forking mainnet applies real deployment rules.

The general form: **a verification chain's guarantees are bounded by the
strictest environment in it.** Build/test/fuzz prove logic; none of them prove
deployability. Any property enforced by the network but not by the test EVM
(size caps, gas dynamics, mempool rules) needs a gate in an environment that
enforces it.

## Disposition (resolved 2026-08-11)

- Interim state: local seeding was unblocked with `anvil
  --disable-code-size-limit`, documented as REQUIRED in
  `script/seed-local.sh`'s header so the workaround could not masquerade as a
  fix.
- The architectural fix landed: the factory registers externally deployed
  children instead of constructing them (runtime 47,890 B -> 7,413 B), per
  `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`,
  merged to main at `a9e1297`. The workaround flag is retired from every
  launch path; the seed smoke now runs under unmodified mainnet rules.
- Standing detection landed as `test/DeploySize.t.sol` — a forge-test gate
  (this repo runs no CI; `forge test` is the gate every session runs)
  asserting the EIP-3860/EIP-170 caps for all four deployables plus a
  24,064 B OVRFLOLending runtime headroom canary. `forge build --sizes`
  remains the diagnostic table, not the gate.

## Remediation tier (per the 2026-08-10 hierarchy)

The finding itself: the missing gate was tier-3 detection that did not exist —
since landed as `test/DeploySize.t.sol`. The architectural fix delivered the
tier-1 remedy (a factory that embeds no child creation code cannot re-grow
past the cap by child growth). The seed smoke earned permanent status as the
deployability gate: it is the only step in the chain that runs under real
mainnet rules end-to-end, and it no longer carries any size escape hatch.

## See also

- `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md` —
  the fix this finding forced, with the trade-off analysis it called for.
- `probe-first-sizing-creation-only-new-stays-out-of-runtime-bytecode.md` —
  the sizing mechanism and probe technique the fix ran on (this doc is the
  detection lesson; that one is the mechanism).
- `script/seed-local.sh` header (now records the real-rules seed, not the
  workaround).
- `.scratch/lending-v1-lite/issues/08-repo-sync.md` resolution notes.
