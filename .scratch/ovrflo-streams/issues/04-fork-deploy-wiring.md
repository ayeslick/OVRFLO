# 04 — Fork deploy wiring

**What to build:** Fork-repo deploy script and README match Deploy sequence steps 2–4 (comptroller → descriptor → lockup). Production and seed pass `initialAdmin` = factory. Fees at zero. Document that OVRFLO production never calls `setNFTDescriptor` on the lockup — it uses the factory forwarder after `setOvrfloStream`.

**Repo:** sibling `OVRFLO-Streams`.

**Blocked by:** 02 and 03

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/04-fork-deploy-wiring.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Repo: sibling OVRFLO-Streams. Do not compile the fork inside OVRFLO.
Do not edit the plan. Do not start Phase B (U5–U10) in the OVRFLO repo.
Before any code, read Required reading and the plan sections: Goal Capsule,
R6, R19 (forwarder lives in OVRFLO, not here), HTD Deploy sequence steps 2–4,
KTD1, ### U4.
Production/seed pass factory as initialAdmin on lockup and comptroller.
Never the Safe. Never the deployer. Fork inherited tests may still pass a
mock registry (R2c) — document that split.
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
- Plan R6, R19 (read so you do **not** implement factory forwarders in the fork), HTD Deploy sequence (binding order and getter checks), ### U4
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **R1 naming.** Deploy `SablierV2Comptroller`, then `OVRFLOStreamDescriptor`, then `SablierV2LockupLinear`. Deployed identity of the lockup is `OVRFLOStream`. Deployed identity of the comptroller is "OVRFLO Streams comptroller". Do not invent `OVRFLOStream.sol` or `OVRFLOStreamComptroller`.
- **R6.** Comptroller deploys with all fees at zero. Admin applies to comptroller and lockup only. Descriptor is stateless and admin-less. Production, local seed, and devnet set the **factory** as `initialAdmin` on both. `Adminable` is one-step with no `acceptAdmin`. A wrong construction admin is unrecoverable. Do not pass the Safe or the deployer.
- **Constructor args (HTD 2–4).** Comptroller: `SablierV2Comptroller(factory)`. Lockup: `SablierV2LockupLinear(factory, comptroller, descriptor)`. `initialAdmin` and immutable `factory` are the same argument.
- **R2c split.** Fork-repo inherited tests may pass a mock registry as admin / `factory` so they can call `onlyAdmin` and `create*` without `OVRFLOFactory`. Document that OVRFLO production never uses that direct `setNFTDescriptor` — it uses `setStreamNFTDescriptor` on the factory after `setOvrfloStream` (HTD step 5). `registerOvrflo` is **not** a prerequisite for that forwarder (U5).
- **R19 / R17** are ticket 05. Do not add `setOvrfloStream` to the fork. Do not implement lending burn.
- **OQ4.** This OVRFLO repo still does not compile or vendor the fork.
- **KTD1.** After this ticket, Phase B consumes the fork by address + committed artifacts. Ticket 05 copies artifacts; this ticket must leave compile settings that 05 can stamp (`bytecode_hash = "none"` is required later by SC11 — if the fork profile still hashes metadata, set `bytecode_hash = "none"` here so 08's pretest can compare).

## This ticket owns / does not own

**Owns:** fork deploy script; README deploy section; deploy-order test against local Anvil; AE5 table complete for Phase A files; smoke `setNFTDescriptor` from test admin.

**Does not own:** `OVRFLOFactory.setOvrfloStream` / `setStreamNFTDescriptor` (05); `script/seed-local.sh` (06); committing artifacts into OVRFLO (05).

## Do not

- Pass the Safe or the deployer as `initialAdmin` in production/seed paths
- Deploy LockupDynamic
- Implement factory forwarders in the fork repo
- Run `forge script --broadcast` against Anvil from the OVRFLO repo (this ticket is fork-repo only)
- Start U5 in the same chat
- Edit the plan file

## Implementation (binding)

1. Deploy script constructor order = HTD steps 2–4. After each deploy, read the named getters and fail on mismatch:
   - Comptroller: `admin() == factory`
   - Descriptor: `code.length > 0`
   - Lockup: `admin() == factory`, `factory() == factory`, comptroller and descriptor bindings
2. Pin fees at zero at deploy.
3. README: production/seed pass factory; inherited tests pass mock registry (R2c); OVRFLO production uses factory `setStreamNFTDescriptor` after `setOvrfloStream`; `registerOvrflo` is not a prerequisite for that forwarder.
4. Smoke-verify `setNFTDescriptor` from the test admin post-deploy (inherited-test path only).
5. Deploy-order test: fresh deployment ends with `admin() == factory()`, `factory()` equal to the configured factory, zero fees, descriptor wired, `create*` succeeding only for an address the mock (or registered vault) admits.
6. Confirm `bytecode_hash = "none"` in the profile that produces shipping bytecode (SC11 will compare rebuilds in ticket 08).
7. AE5: `git diff --stat v1.1.2 -- src/` every reported file appears in the deviations table with cause named.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

## Deviations from the plan

1. **U2+U3 merge left `EnumerableMintGate.t.sol` importing deleted `SablierV2NFTDescriptor`.** The suite cannot compile without that import. This ticket switches the import to `OVRFLOStreamDescriptor` and asserts ERC721 identity `"OVRFLO Stream"` / `"OVRFLOStream"` (KTD5). The plan did not assign that file to U4. Forced by compile.
2. **Core2 scripts also drop LockupDynamic.** The plan names the production/seed path (HTD 2–4). `DeployCore2` and `DeployDeterministicCore2` still constructed Dynamic. This ticket removes that construct so every Core script matches the production order. Dedicated `DeployLockupDynamic` scripts stay in the tree.
3. **Individual deploy scripts gained NatSpec only.** `DeployComptroller`, `DeployLockupLinear`, and the Dynamic scripts now state factory-as-admin and that Dynamic is not the production path. No constructor change.

## Final diff

- Predicted blast radius: `script/DeployCore.s.sol`, `script/DeployDeterministicCore.s.sol`, `script/DeployCore2.s.sol`, `script/DeployDeterministicCore2.s.sol`, `README.md`, `CHANGES.md`, `foundry.toml`, `test/deploy/DeployOrder.t.sol`, `test/enumerable/EnumerableMintGate.t.sol`, this ticket
- Actual (`git diff --stat feat/streams-u2-u3`):

```
 CHANGES.md                                    |   9 +-
 README.md                                     |  46 +++++++++
 foundry.toml                                  |   6 +-
 script/DeployComptroller.s.sol                |   2 +
 script/DeployCore.s.sol                       | 108 ++++++++++++++++++---
 script/DeployCore2.s.sol                      |  26 +++--
 script/DeployDeterministicCore.s.sol          |  75 ++++++++++++---
 script/DeployDeterministicCore2.s.sol         |  30 +++---
 script/DeployDeterministicLockupDynamic.s.sol |   1 +
 script/DeployLockupDynamic.s.sol              |   2 +
 script/DeployLockupLinear.s.sol               |   2 +
 test/deploy/DeployOrder.t.sol                 | 133 ++++++++++++++++++++++++++
 test/enumerable/EnumerableMintGate.t.sol      |  12 +--
 13 files changed, 378 insertions(+), 74 deletions(-)
```

- Misses: NatSpec-only edits on `DeployComptroller`, `DeployLockupLinear`, and the two Dynamic scripts. Logged as deviation 3.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] Scripted deploy against local Anvil produces a working stream layer
- [x] Fresh deployment: `admin() == factory()`, factory binding correct, fees zero, descriptor wired
- [x] `create*` succeeds only for an address the mock (or registered vault) admits
- [x] README states production `initialAdmin` = factory, never Safe, never deployer
- [x] README states OVRFLO production uses `setStreamNFTDescriptor` after `setOvrfloStream`, and `registerOvrflo` is not a prerequisite
- [x] LockupDynamic is not in the deploy script
- [x] Deviations table complete for Phase A (Covers AE5)
- [x] Shipping profile has `bytecode_hash = "none"`

## Plan unit

U4 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
