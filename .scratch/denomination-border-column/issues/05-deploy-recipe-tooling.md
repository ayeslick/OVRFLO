# 05 — Deploy recipe and seed tooling

**What to build:** Deploy and seed still run "deploy vault, then `registerOvrflo(vault)`." The runbook reads creation wiring and minter bindings. The deployment artifact gains `reserve` under the same paired-optional consume rule as vault and lending. Fixture deploy helpers return the reserve as a new tuple member. `DeploySize` gates `OVRFLOReserve`. The client env contract gains no reserve variable; the web learns `reserve` from factory discovery in ticket 07.

**Blocked by:** 04

**Status:** resolved
**Labels:** ready-for-human

## Intent (ticket/05, 2026-09-02) — before code

Assumptions: nested constructors already exist (U2); factory `ovrfloToReserve` already exists (U4); this unit wires that column into deploy, seed, fixtures, the artifact writer, and DeploySize. `web/lib/config.ts` stays unchanged. Ticket 07 owns factory discovery of `reserve` and must not gain `NEXT_PUBLIC_OVRFLO_RESERVE`. Storage goldens already include `OVRFLOReserve`; this unit does not change storage. Fuzz and invariant files already compile; 06 owns re-derivation. Seed demo supply and borrow follow the U3 asset and `onBehalfOf` ABI, or the seed smoke fails.

Predicted blast radius: `script/OVRFLO.s.sol`, `script/seed-local.sh`, `script/lib/OVRFLOTestFixtures.sol`, `script/lib/OVRFLOSeedRunner.sol`, `test/fork/OVRFLOForkBase.t.sol`, `tools/scripts/write-deployment-artifact.mjs`, `web/tests/scripts/deployment-artifact.test.ts`, `test/DeploySize.t.sol`, this ticket.

Verification: `forge build` then `forge test`; `forge fmt --check`; `bash tools/scripts/check-storage-layout.sh`; artifact pairing tests; seed smoke or an environment-gate result; no `NEXT_PUBLIC_OVRFLO_RESERVE` in `web/lib/config.ts`.

Reuse: seed `require_eq`, fixture `require` after deploy, artifact `optionalAddress` pairing, DeploySize `_artifacts()` array. No new abstraction.

Rejected: a struct return from `_deployConfiguredSystemAs` (would not break positional destructurers); adding `NEXT_PUBLIC_OVRFLO_RESERVE`; allowing `ovrflo` present and `reserve` absent (violates the joined consume rule).

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
Fuzz and invariant files: minimum edit to keep plain forge test green, nothing
more. Do not run FOUNDRY_PROFILE=invariant or the fizz harness. 06 owns the
re-derivation later; log each minimum edit on this ticket.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/05 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rule 2)
- `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`
- `docs/agents/testing.md`
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Deploy runbook steps 6–9: deploy vault, `registerOvrflo(vault)`, creation-wiring reads, minter-binding reads
- [x] Seed writes `reserve` into `deployments/local.json`
- [x] Artifact `reserve` follows the paired-optional consume rule (both present or both derived)
- [x] Fixture return tuple includes `reserve`; old positional destructurers fail to compile until updated
- [x] `test/DeploySize.t.sol` gates `OVRFLOReserve` against EIP-170 and EIP-3860 caps
- [x] Client env contract is unchanged; `NEXT_PUBLIC_OVRFLO_RESERVE` is obsolete, not added
- [x] `bash tools/scripts/check-storage-layout.sh` is green
- [x] `bash script/seed-local.sh` deploys a nested column and registers it, or an environment gate is recorded
- [x] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U5 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session log

Fuzz and invariant files: no minimum edits. Plain `forge test` stayed green without touching those suites.

`web/lib/config.ts` is unchanged. `NEXT_PUBLIC_OVRFLO_RESERVE` is not added.

`git diff --stat` vs predicted blast radius: match, plus this ticket. `script/local-stress-test.sh` still calls vault wrap/unwrap and wstETH supply; that file is not in U5 and was already stale after U2/U3. Left for a later ticket.

Seed smoke environment gate (2026-09-02): `MAINNET_RPC_URL` was present. Anvil fork started. `script/seed-local.sh` stopped at Pendle discovery: 1 qualifying wstETH market, need 2. Retry with `PENDLE_EXPIRY_BUFFER_DAYS=0` still found 1. Nested deploy/register was not reached on the live fork. Nested constructors plus `registerOvrflo` remain covered by the fixture `require`s and by `test/OVRFLOFactory.t.sol`. Did not fake a second market.

Legacy compile: `_runSeed` cannot keep a `reserve` local plus the existing write arguments (stack too deep). SeedDevnet JSON still writes `reserve` from `ovrflo.reserve()`.

`forge build` then `forge test`: 379 passed, 0 failed, 5 skipped (fork suites without RPC in that run). `forge fmt --check` clean. `check-storage-layout.sh` green. Artifact tests: 9 passed. DeploySize: three tests passed, including `OVRFLOReserve`.

Review: GPT-5.6 Sol reported no findings. This chat accepts that report.
