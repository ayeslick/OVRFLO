---
title: Probe-first EVM sizing — creation-only `new` stays out of deployed runtime bytecode
date: 2026-08-11
category: best-practices
module: "src/OVRFLOFactory.sol, src/OVRFLO.sol, src/OVRFLOToken.sol, src/OVRFLOLending.sol"
problem_type: best_practice
component: contract-sizing
severity: medium
applies_when:
  - "Deciding between architectural candidates for contract deployment size (EIP-170 runtime cap, EIP-3860 initcode cap) before implementing either"
  - "Verifying whether a constructor-only `new ChildContract(...)` call adds to deployed runtime bytecode or only to initcode"
  - "A plan or review argument depends on an unverified guess about deployed bytecode size"
  - "Choosing between an architecture that embeds child creation code in a runtime-reachable function and one that does not"
  - "Deciding whether to compile a throwaway probe contract to measure an architectural candidate before implementing or debating it"
tags: [eip-170, eip-3860, initcode, runtime-bytecode, new-keyword, probe-contract, contract-sizing, solidity]
---

# Probe-first EVM sizing — creation-only `new` stays out of deployed runtime bytecode

## Context

The old `OVRFLOFactory` deployed `OVRFLO` and `OVRFLOLending` from inside its own runtime via `new`. The blocker surfaced at ticket 08's seed smoke — the first gate in the verification chain enforcing real mainnet rules — measuring 50,609 B initcode (over EIP-3860's 49,152) and 50,122 B runtime (over EIP-170's 24,576, ~2x); the finding was deliberately deferred past the v1-lite merge with an interim `--disable-code-size-limit` workaround, and no fix approaches were explored before the fix plan (session history). At fix time the factory measured 47,890 B runtime because solc had embedded 38,848 B of child creation code directly into the factory's deployed bytecode. The fix (plan `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`, merged to `main` at `a9e1297` — merge commit "the factory registers, it doesn't construct") replaced factory-side construction with permissionless child deployment plus `onlyOwner` registration. Two probes, not argument, decided the shape of that fix. The gap this closes: reasoning about EVM contract-size limits from source-reading alone is unreliable — solc's placement of `new`-generated code between initcode and runtime is not visible by inspection, and architectural alternatives that look plausible on paper can be falsified in minutes by compiling a throwaway.

## Guidance

**1. `new Child()` only costs runtime bytes if it executes at runtime.** If every call site is inside a constructor, solc places the child's full creation code in the *parent's initcode*, not its deployed *runtime* — the constructor path executes once at deploy time and is stripped from what ends up on-chain. The same `new` written inside a regular (non-constructor) function keeps the child's creation code resident in runtime because that path can be re-executed post-deployment. Applied in this repo: `src/OVRFLO.sol`'s constructor (~line 274-293) now does `ovrfloToken = address(new OVRFLOToken(name_, symbol_))` — OVRFLO's runtime stayed 9,895 B (unchanged) while its initcode grew 10,787 -> ~14,736 B. The same mechanism makes `OVRFLOLending`'s constructor-end call `_transferOwnership(factory_)` (`src/OVRFLOLending.sol:337`) cost 0 runtime bytes — it's OZ's `Ownable2Step` internal, but the principle (constructor-only code paths don't survive into runtime) is identical.

Corollary, the failure mode this fix escaped: any contract whose **runtime** (not constructor) calls `new Child()` embeds `Child`'s entire creation code in its own deployed bytecode. That's exactly what the old `OVRFLOFactory` did in its `deploy()` function, and exactly why a minimal one-function `OVRFLOLending` deployer probe still measured 24,683 B runtime — over the EIP-170 cap by itself, before adding a single other line.

**2. Before arguing about size-sensitive architecture, compile a throwaway probe and measure it.** Don't reason from source about whether a split-deployer pattern, a constructor refactor, or a library extraction will fit under EIP-170/EIP-3860 — write a 10-15 line probe contract with the shape in question, `forge build`, and read the actual byte count:

```
forge inspect <Contract> deployedBytecode | tr -d '\n' | wc -c
```
then `(chars - 2) / 2` = runtime bytes (the `-2` strips the `0x` prefix; hex is 2 chars/byte). Same pattern with `bytecode` instead of `deployedBytecode` for initcode. Create the probe under `script/`, measure, delete it in the same command sequence — never commit a probe.

**Caveat:** `forge inspect ... bytecode` reports initcode *without* constructor arguments — ABI-encoded args are appended at deploy time and add bytes beyond what the probe measures, so keep margin rather than treating the probe number as the deploy-time ceiling. And EIP-3860's 49,152 B initcode cap still bounds constructor-embedding — it's cheaper, not free. This repo has one intentional remaining instance of the coupling the probe validated: `OVRFLO`'s initcode now embeds `OVRFLOToken`'s creation code (Key Decision 7(a) in the plan), which is exactly why probe 2 was run before committing to it — to confirm the initcode growth (~+3.7 KB) stayed far under the 49,152 B cap rather than assuming it.

## Why This Matters

Solc's initcode/runtime split is not something you can eyeball from a `new` call site — it depends on *where* the call site is (constructor vs. function), and getting it wrong either produces a surprise EIP-170 failure at deploy time (expensive to discover late) or drives an architecture change that isn't actually necessary (expensive to discover never). In this case the mechanism had a security payoff beyond code size: because `OVRFLO`'s constructor builds and owns `OVRFLOToken` from the token's very first instant, the "deployer holds token ownership pre-handoff and can mint unbacked supply" window is unrepresentable rather than merely checked — a tier-1 result per the remediation-tier discipline in `docs/solutions/patterns/ovrflo-coding-standard.md` (eliminate the bad state, don't guard it) that fell out of a size-driven refactor. On the process side, the two probes turned two different kinds of uncertainty into settled facts inside one session: probe 1 (the minimal lending-deployer probe, 24,683 B runtime) falsified the "split deployer contracts" alternative by measurement, closing off a plausible-looking direction before time was spent designing it; probe 2 (constructor-vs-function `new` placement) converted what started as a user suggestion into a Key Decision with zero-runtime-cost evidence attached, rather than a judgment call resting on solc folklore.

## When to Apply

- Any contract approaching the EIP-170 runtime cap (24,576 B) — check with `forge build --sizes`.
- Any contract that `new`s a child contract, especially a factory/deployer pattern — check whether the call site is constructor-only (cheap in runtime) or reachable from a regular function (expensive in runtime, embeds the full child creation code).
- Before proposing or reviewing a size-driven architecture change (splitting a contract, moving construction between contracts, extracting a library) — measure with a probe first; don't let the discussion proceed on assumption.
- This repo's standing detection surfaces: `forge build --sizes` for a quick scan, and `test/DeploySize.t.sol` as the permanent forge-test gate (this repo runs no CI; `forge test` is the gate every session runs) — it asserts every deployable artifact's `vm.getCode`/`vm.getDeployedCode` lengths against the EIP-3860/EIP-170 caps and carries a deliberate `LENDING_RUNTIME_CANARY = 24_064` (`test/DeploySize.t.sol:23`, 512 B headroom reserve under the cap) so `OVRFLOLending` growth gets an early warning before it ever gets close to 24,576 B.

## Examples

The shape of probe 2 (constructor-only `new` vs. function-scoped `new`) and the measurement loop; the byte counts are the session's actual measurements of these probes against `OVRFLOToken`:

```solidity
// probe A — new only reachable from the constructor
contract TokenInCtorProbe {
    address public immutable token;
    constructor(string memory name_, string memory symbol_) {
        token = address(new OVRFLOToken(name_, symbol_));
    }
}

// probe B — identical new, but reachable from a runtime function
contract TokenInFnProbe {
    function deploy(string memory name_, string memory symbol_) external returns (address) {
        return address(new OVRFLOToken(name_, symbol_));
    }
}
```
```
forge build
forge inspect TokenInCtorProbe deployedBytecode | tr -d '\n' | wc -c   # -> (chars-2)/2 = 162 B runtime
forge inspect TokenInFnProbe   deployedBytecode | tr -d '\n' | wc -c   # -> (chars-2)/2 = 4,279 B runtime
```

Constructor-only placement: **162 B runtime** (4,372 B initcode). Function-scoped placement of the identical `new`: **4,279 B runtime**. That ~4.1 KB delta, scaled up to the factory's two children, is what pushed the old `OVRFLOFactory` to 47,890 B runtime and is what `Architecture B — register, don't construct` (plan Key Decision 1) eliminated by moving deployment to permissionless standalone calls with `onlyOwner` registration instead of factory-side `new`.

## Related

- `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md` — Problem Frame, probes 1-2, Alternatives, Key Decisions (primary written record for this fix).
- Merge commit `a9e1297`, branch `fix/factory-mainnet-code-size-registry` ("the factory registers, it doesn't construct").
- [`environment-fidelity-mainnet-rules-gates-20260810.md`](environment-fidelity-mainnet-rules-gates-20260810.md) — the detection lesson this fix resolves: why every earlier gate was blind to the size cap until an environment enforced real mainnet rules.
- [`packed-slot-vm-load-verification-20260808.md`](packed-slot-vm-load-verification-20260808.md) — same measure-don't-assert family, applied to storage-slot packing (`forge inspect storageLayout` + `vm.load`) instead of bytecode length.
- [`../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md`](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md) — the admin-model half of the same change (register-don't-construct as an admin pattern); this doc is the EVM-mechanics half.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` #8/#9 — refreshed 2026-08-11 to the registration surface this mechanism enabled.
- `src/OVRFLO.sol` constructor (~line 274-293), `src/OVRFLOLending.sol:317-337`, `test/DeploySize.t.sol`.
