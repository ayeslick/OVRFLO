# 06 — Seeding + fork tests

**What to build:** Local seeding and the fork-test suite run against a deployed `OVRFLOStream`. Follow the HTD Deploy sequence. Anvil uses `forge create` + `cast send` for factory/vault/lending and `cast send --create` for the three committed artifacts. Rebind `SABLIER=` and `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` by **value**, not by renaming. Missing stream address fails boot loudly.

**Repo:** this OVRFLO repo.

**Blocked by:** 05

**Status:** resolved (sha `5d9c678e50a8f57f1496b363e87471d650653177`; branch `feat/u6-seeding-fork-tests`; worktree `/Users/jay/OVRFLO-u6`)

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/06-seeding-and-fork-tests.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Do not edit the plan. Do not start U7–U10. Do not compile the fork in this repo.
Do not vm.etch fork bytecode. Do not forge script --broadcast against Anvil
(critical pattern #2). Devnet bootstrap-devnet.sh may keep forge script --broadcast.
Before any code, read Required reading and the plan sections: HTD Deploy sequence
(all 11 steps), R6, R10, R19, KTD1, KTD7, SC23, SC24, ### U6.
SABLIER= keeps its name and changes its value to the deployed lockup.
Rewrite script/OVRFLO.s.sol comment block as the operator runbook.
Keep one S1–S5 differential probe against canonical Sablier still resident
at the pinned fork block — do not let our code assert only against itself.
INTENT RECORD (before the first code write): post assumptions, predicted
blast radius, and the verification that will prove this ticket. Log plan
deviations on this ticket with why; do not edit the plan. Before Status:
resolved, fill Final diff from git diff --stat vs that prediction. Do not
reconstruct the record afterward. See spec.md Intent record and
docs/agents/onboarding.md Before writing code.
After verification, mark ticket checkboxes done and set Status: resolved.
Commit with write-tree / commit-tree / update-ref. Never git commit.
```

**Required reading:**

- `.scratch/ovrflo-streams/spec.md` (Intent record)
- `docs/agents/onboarding.md` § Before writing code
- `docs/solutions/patterns/solidity-implementation-discipline.md` Sequence 6–9
- Plan HTD Deploy sequence (binding); R6, R10, R19; KTD1, KTD7; SC23, SC24; ### U6
- `docs/solutions/patterns/ovrflo-critical-patterns.md` rule 2 (Anvil broadcast)
- `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`
- `docs/audit/sablier-interface-contract.md` S1–S5 (differential probe)
- `docs/agents/testing.md` if you touch bootstrap
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **KTD1.** Deploy fork contracts from committed artifacts via `cast send --create` (Anvil seed) and `vm.getCode` (`SeedDevnet.s.sol` / `OVRFLOSeedRunner`). `forge create` cannot deploy a contract this repo does not compile. Never `vm.etch`.
- **CP#2.** Against Anvil, factory, vault, and lending use `forge create` + `cast send`. Never `forge script --broadcast`. Devnet (`bootstrap-devnet.sh`) may keep `forge script --broadcast`.
- **R9.** `SABLIER=` keeps its name. It is load-bearing (seeded borrow's stream-NFT approval uses it). Rebind the **value** to the deployed lockup. `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` likewise keeps its name.
- **HTD order.** Factory → comptroller (admin = factory, fees 0) → descriptor → lockup (admin and factory = factory) → Safe `setOvrfloStream` → vault with factory as admin and stream last → `registerOvrflo` → lending → `registerLending` (no re-check of factory/admin/comptroller.admin) → oracle/market/spacing → write artifact. After each deploy, read named getters and fail on mismatch (SC23).
- **Do not pass the Safe or the deployer as `initialAdmin`.**
- **SC24.** Derive the stream address. Do not accept it as an unverified supplied field. Read it from the vault, check code is non-empty, cross-check the lending market's binding, add it to the identity field list and the environment gate.
- **Silent-empty is forbidden.** An absent env var that degrades to `address(0)` makes `balanceOf` return 0 and renders the lens ready-empty. `required()` validation in **both** runtime profiles and the artifact's chain-verified field set must fail boot loudly.
- **R17/R19 behavior** is already in 05. This ticket proves it against real bytecode for AE4 (third-party withdraw) and AE9 (create* against production registry).
- **Fork tests** still self-skip without `MAINNET_RPC_URL`. That is the baseline, not a gate failure.

## This ticket owns / does not own

**Owns:** `script/seed-local.sh`; `script/OVRFLO.s.sol` comment-block runbook; `SeedDevnet.s.sol`; `OVRFLOSeedRunner.sol`; bootstrap/walkthrough/stress scripts listed in the plan; `test/fork/*.sol`; `write-deployment-artifact.mjs`; `write-env.sh`; `foundry.toml` artifact read permission if 05 missed it; `verify-deployment-input.mjs`; `VaultMockHelpers.sol`; `web/app/risk/riskCopy.ts` if it still names canonical Sablier as the live layer; S1–S5 differential test.

**Does not own:** frontend discovery (08) beyond env piping; audit markdown (07); E2E (10). R15 env wiring is this ticket; 08's unit tests do not need seed.

## Do not

- `forge script --broadcast` against Anvil
- `vm.etch` fork bytecode
- Rename `SABLIER=` or `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS`
- Pass Safe/deployer as lockup or comptroller admin
- Skip `setOvrfloStream` or `registerOvrflo` (there is no `setMinter` to substitute)
- Re-check `stream.factory()` inside `registerLending`
- Let a missing stream address become `address(0)`
- Drop the canonical-Sablier differential probe
- Edit the plan file

## Implementation (binding)

1. Rewrite seed to HTD steps 1–11. Fork contracts: `cast send --create` from artifacts. After each step, read getters (SC23).
2. `SABLIER=` = deployed lockup address.
3. `write-deployment-artifact.mjs` gains a stream field derived per SC24. `write-env.sh` emits `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS`.
4. Both runtime profiles: `required()` on the stream address. Missing → loud fail, never empty lens.
5. Rewrite `script/OVRFLO.s.sol` comment block: operator runbook for the Deploy sequence, including `cast send --create`, `setOvrfloStream` after lockup, `forge verify-contract` recipe with pinned settings and GPL license id, complete production `NEXT_PUBLIC_*` list.
6. Fork tests: deploy `OVRFLOStream` onto the mainnet fork in `setUp` instead of binding the canonical address. Keep one differential test: S1–S5 probes against **both** our deployment and canonical Sablier at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (still resident at the pinned fork block) and assert identical outcomes.
7. Assert seed vault binding is not the canonical Sablier address (on a mainnet fork a missed rebind succeeds against live upstream code rather than reverting).
8. Assert `ovrfloStream.admin()` and `comptroller.admin()` equal the factory, and `factory.ovrfloStream()` equals the seeded stream.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

Posted 2026-08-15 in the U6 implementing session **before the first code write**.

**Assumptions.** U5 rebound the vault constructor (`stream` last) and factory `setOvrfloStream`. This ticket deploys the three committed artifacts with `cast send --create` (Anvil) and `vm.getCode` / `deployCode` (SeedDevnet + fork tests). Factory is `initialAdmin` on the lockup and the comptroller. Fees stay 0. `SABLIER=` and `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` keep their names and change their values. The artifact writer derives the stream address from the vault, checks code, and cross-checks lending (SC24). A missing stream address fails `required()` in both runtime profiles. Fork tests self-skip without `MAINNET_RPC_URL`. Canonical Sablier at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` stays resident at the pinned fork block for one S1–S5 differential probe. Unit/fizz suites stay on `MockSablier` / `vm.etch(hex"00")` stubs. No `vm.etch` of fork bytecode. No `forge script --broadcast` against Anvil.

**Predicted blast radius.** `script/seed-local.sh`; `script/OVRFLO.s.sol` (comment-block runbook); `script/lib/OVRFLOTestFixtures.sol`; `script/lib/OVRFLOSeedRunner.sol`; `script/SeedDevnet.s.sol` if spacing/SC23 is missing; `script/local-stress-test.sh`; `tools/scripts/walkthrough-local.sh`; `tools/scripts/write-deployment-artifact.mjs`; `tools/scripts/write-env.sh`; `web/scripts/verify-deployment-input.mjs`; `web/lib/config.ts` + `web/tests/lib/config.test.ts`; `web/tests/scripts/deployment-artifact.test.ts`; `web/tests/scripts/security-packaging.test.ts`; `web/tests/setup.ts`; `web/.env.example`; `web/app/risk/riskCopy.ts`; `test/helpers/VaultMockHelpers.sol` (comment only); `test/fork/*.sol` (fixtures + one S1–S5 differential). Callers: `bootstrap-local.sh` (seed then write-env), frontend modules that import `SABLIER_LOCKUP_ADDRESS`, fork tests via `_deployConfiguredSystemAs`. `foundry.toml` already has artifact read permission.

**Verification that fails if this ticket is wrong.** `forge build`. `forge test` (fork tests skip without `MAINNET_RPC_URL`). With RPC: `bash script/seed-local.sh` deposit→stream→borrow, vault binding ≠ canonical, factory/admin getters, unregistered `create*` reverts. `forge test --match-path test/fork/* --fork-url $MAINNET_RPC_URL` including S1–S5 differential and AE4 escrow withdraw. Vitest: missing stream fails both profiles; artifact derives stream; risk copy does not name canonical as the live layer.

**Owns vs later.** This ticket owns seeding, env piping (R15), fork-test rebind, operator runbook. U7 owns audit/docs vocabulary. U8 owns Enumerable discovery (it consumes the env-piped address). U9 owns the card. U10 owns E2E.

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

## Deviations from the plan

1. `OVRFLOTestFixtures` deploys artifacts with forge-std `deployCode` instead of inlined `vm.getCode`. `deployCode` reads the same committed JSON and creates the contract. No `vm.etch` of fork bytecode.
2. `_runSeed` gained `_deployAndRegisterLending` because the extra stream local hit stack-too-deep. HTD steps 8–10 stay the same.
3. The seed proof used `PENDLE_EXPIRY_BUFFER_DAYS=7`. The live wstETH pool had one market inside the 14-day default. `seed-local.sh` documents that override. The plan file was not edited.

## Final diff

- Predicted blast radius: `script/seed-local.sh`; `script/OVRFLO.s.sol`; `script/lib/OVRFLOTestFixtures.sol`; `script/lib/OVRFLOSeedRunner.sol`; `script/SeedDevnet.s.sol` if spacing/SC23 is missing; `script/local-stress-test.sh`; `tools/scripts/walkthrough-local.sh`; `tools/scripts/write-deployment-artifact.mjs`; `tools/scripts/write-env.sh`; `web/scripts/verify-deployment-input.mjs`; `web/lib/config.ts` + `web/tests/lib/config.test.ts`; `web/tests/scripts/deployment-artifact.test.ts`; `web/tests/scripts/security-packaging.test.ts`; `web/tests/setup.ts`; `web/.env.example`; `web/app/risk/riskCopy.ts`; `test/helpers/VaultMockHelpers.sol` (comment only); `test/fork/*.sol` (fixtures + one S1–S5 differential).
- Actual (`git show --stat 5d9c678`): 19 files, +779 −104. `script/OVRFLO.s.sol`, `script/lib/OVRFLOSeedRunner.sol`, `script/lib/OVRFLOTestFixtures.sol`, `script/local-stress-test.sh`, `script/seed-local.sh`, `test/fork/OVRFLOLendingMainnetFork.t.sol`, `test/fork/OVRFLOStreamDifferential.t.sol` (new), `test/helpers/VaultMockHelpers.sol`, `tools/scripts/walkthrough-local.sh`, `tools/scripts/write-deployment-artifact.mjs`, `tools/scripts/write-env.sh`, `web/.env.example`, `web/app/risk/riskCopy.ts`, `web/lib/config.ts`, `web/scripts/verify-deployment-input.mjs`, `web/tests/lib/config.test.ts`, `web/tests/scripts/deployment-artifact.test.ts`, `web/tests/scripts/security-packaging.test.ts`, `web/tests/setup.ts`.
- Misses: `script/SeedDevnet.s.sol` unchanged. Spacing and SC23 live in `OVRFLOSeedRunner`, which SeedDevnet already calls. `bootstrap-devnet.sh` already runs `write-deployment-artifact.mjs`, which derives `stream` (SC24).

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] `bash script/seed-local.sh` produces a working book (deposit → stream → borrow)
- [x] Seeded vault binding is not `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`
- [x] `ovrfloStream.admin()` and `comptroller.admin()` equal the factory; `factory.ovrfloStream()` equals the seeded stream
- [x] After seed, an address whose `ovrfloInfo` treasury is zero calling `create*` reverts (Covers AE9 against the production registry)
- [x] Third-party withdraw reverts through the lending settlement path against real fork bytecode (Covers AE4)
- [x] Fork tests green under `MAINNET_RPC_URL`, including S1–S5 differential probe
- [x] Fork tests self-skip without `MAINNET_RPC_URL`
- [x] Missing stream address fails boot loudly in both runtime profiles
- [x] `SABLIER=` and `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` names unchanged
- [x] No `forge script --broadcast` on the Anvil seed path
- [x] `script/OVRFLO.s.sol` comment block is the operator runbook (sequence, verify recipe, env list)
- [x] Stream address is derived (SC24), not copied through unverified

## Plan unit

U6 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
