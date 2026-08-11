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

## Disposition

- Local seeding unblocked with `anvil --disable-code-size-limit` — documented
  as REQUIRED in `script/seed-local.sh`'s header alongside the finding, so the
  workaround cannot masquerade as a fix.
- The architectural fix (factory must stop embedding all child creation code)
  is a separate planned effort with its own trade-off analysis (admin model is
  load-bearing; clones-vs-split-deployer is a real design decision).
- Standing detection: a size gate (`forge build --sizes` with a failure
  threshold) belongs in the Verification Contract so regression toward either
  cap is caught at build time, not at deploy time. This lands with the
  architectural fix's plan.

## Remediation tier (per the 2026-08-10 hierarchy)

The finding itself: the missing gate was tier-3 detection that did not exist —
now specified. The architectural fix is the tier-1 remedy (a factory that does
not embed child creation code cannot re-grow past the cap by child growth).
The seed smoke earned permanent status as the deployability gate: it is the
only step in the chain that runs under real mainnet rules end-to-end.

## See also

- `script/seed-local.sh` header (workaround + finding record).
- `.scratch/lending-v1-lite/issues/08-repo-sync.md` resolution notes.
