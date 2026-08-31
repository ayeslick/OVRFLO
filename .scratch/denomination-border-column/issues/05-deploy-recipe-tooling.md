# 05 — Deploy recipe and seed tooling

**What to build:** Deploy and seed still run "deploy vault, then `registerOvrflo(vault)`." The runbook reads creation wiring and minter bindings. The deployment artifact gains `reserve` under the same paired-optional consume rule as vault and lending. Fixture deploy helpers return the reserve as a new tuple member. `DeploySize` gates `OVRFLOReserve`. The client env contract gains no reserve variable; the web learns `reserve` from factory discovery in ticket 07.

**Blocked by:** 04

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/05-deploy-recipe-tooling.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add NEXT_PUBLIC_OVRFLO_RESERVE.
Do not flip remaining web call sites (07). Never forge script --broadcast against
local Anvil.
Before any code, read Required reading below and the plan sections: KD5, KD11,
Sweep rule 2, Verification Contract items 3–5, and ### CS1 U5.
Positional destructurers of _deployConfiguredSystemAs must break at compile time
when the reserve member is added. Seed smoke: if MAINNET_RPC_URL is unavailable,
record an environment-gate result; never fake it.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rule 2)
- `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`
- `docs/agents/testing.md`
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Deploy runbook steps 6–9: deploy vault, `registerOvrflo(vault)`, creation-wiring reads, minter-binding reads
- [ ] Seed writes `reserve` into `deployments/local.json`
- [ ] Artifact `reserve` follows the paired-optional consume rule (both present or both derived)
- [ ] Fixture return tuple includes `reserve`; old positional destructurers fail to compile until updated
- [ ] `test/DeploySize.t.sol` gates `OVRFLOReserve` against EIP-170 and EIP-3860 caps
- [ ] Client env contract is unchanged; `NEXT_PUBLIC_OVRFLO_RESERVE` is obsolete, not added
- [ ] `bash tools/scripts/check-storage-layout.sh` is green
- [ ] `bash script/seed-local.sh` deploys a nested column and registers it, or an environment gate is recorded
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U5 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
