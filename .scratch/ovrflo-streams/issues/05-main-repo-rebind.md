# 05 — Main-repo rebind

**What to build:** This OVRFLO repo binds the fork by address. Commit three artifacts. Extend `ISablierV2LockupLinear` (keep the name). Vault stream binding becomes a constructor argument (`sablierLL()` getter stays). Factory stores canonical stream (`setOvrfloStream` once) and forwards only `setStreamNFTDescriptor`. Lending disposes of the NFT on `close` and on `repay` when remaining is zero (burn if empty, else return). Unit/fuzz/invariant suites stay on `MockSablier`. **Do not split this ticket.**

**Repo:** this OVRFLO repo (MIT). Do not compile the fork here.

**Blocked by:** 04

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/05-main-repo-rebind.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Do not edit the plan. Do not start U6–U10. Do not compile OVRFLO-Streams in this repo.
Do not vm.etch fork bytecode. Do not rename ISablierV2LockupLinear, sablierLL,
SablierMismatch, MockSablier, or SABLIER_LOCKUP_ADDRESS.
Before any code, read Required reading and the plan sections: Goal Capsule,
R8, R9, R17, R19, KTD1, KTD6, SC10, SC23, ### U5, Verification Contract (DeploySize
512 B canary).
R17 runs on close AND on repay when remaining == 0. claim can empty the stream
while the loan stays open; a later full repay must not return that depleted NFT.
registerLending does NOT re-check stream.factory() / admin() / comptroller.admin().
Those checks live on setOvrfloStream only.
Do not add ovrfloStream() on the vault. Do not add transferAdmin or fee forwarders.
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
- Plan R8, R9, R17, R19 (full text); KTD1, KTD6; SC10, SC23; ### U5; HTD Deploy sequence steps 5–9; Verification Contract DeploySize row
- `docs/solutions/patterns/solidity-implementation-discipline.md` Sequence 6–9
- `docs/solutions/patterns/ovrflo-coding-standard.md` (error names)
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- `BASE_SECURITY.md`
- https://ethskills.com/SKILL.md
- Live code: `src/OVRFLO.sol` constructor and `sablierLL` immutable (today hardcoded at the canonical address); `src/OVRFLOFactory.sol` `OvrfloInfo`, `registerOvrflo`, `registerLending` `SablierMismatch`; `src/OVRFLOLending.sol` `repay` / `close` / `claim`; `interfaces/ISablierV2LockupLinear.sol`
- `test/DeploySize.t.sol` (lending canary 512 B — re-measure before adding R17)
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

Read these as the spec. If implementation disagrees, stop and surface. Do not "fix" the plan locally.

### Naming (R1, R9)

- Do not rename `ISablierV2LockupLinear`, `sablierLL`, `sablier`, `SablierMismatch`, `SABLIER_LOCKUP_ADDRESS`, `SABLIER_ADDR`, `MockSablier`, `MockLendingSablier`.
- Do not add `ovrfloStream()` on the vault. That getter lives on the factory. HTD step 6 reads vault `factory()` and `sablierLL()`.
- Do not invent a Solidity contract `OVRFLOStream` or `OVRFLOStreamComptroller` in this repo. Artifacts are named `OVRFLOStream.json` (lockup bytecode), `SablierV2Comptroller.json`, `OVRFLOStreamDescriptor.json`.
- NatSpec that names the stream layer says "OVRFLO Stream".

### Consume by address (KTD1, OQ4)

- This repo never compiles the fork, never submodules it, never `vm.etch`es its bytecode (constructor would not run; factory immutable would be wrong).
- Commit three Foundry-shaped artifacts plus sibling provenance files: lockup, comptroller, descriptor. Each carries GPL-3.0-or-later notices, Corresponding Source pointer (fork repo tag and commit), and a statement that object code is GPL even though surrounding MIT sources that only call by address are not derivative.
- `foundry.toml` gains read access to the artifact directory.
- Fixtures keep `MockSablier` / `MockLendingSablier`. Real bytecode is ticket 06.

### Vault constructor (KTD6)

- Remove the inline hardcode of canonical Sablier on the vault immutable.
- Pass factory as the existing `admin` argument. Add `stream` as the new **last** argument.
- Guard: revert on `address(0)` and require `code.length > 0` (mismatch check passes when both bindings are zero).
- Update every constructor site: `script/lib/OVRFLOTestFixtures.sol`, `script/lib/OVRFLOSeedRunner.sol`, tests. They break at compile time until updated.
- After KTD6, matching audited vault bytecode no longer implies a correct stream binding. Registration in `ovrfloInfo` is the only safe "is this a real vault" predicate. Ticket 07 documents that; still do not skip the constructor guard.

### Factory admission (R8, R19)

- `setOvrfloStream(address stream)` — `onlyOwner`, once. Revert if already set, zero address, or `stream.code.length == 0`. Require:
  - `ISablierV2LockupLinear(stream).factory() == address(this)` → `StreamFactoryMismatch`
  - `admin() == address(this)` → `StreamAdminMismatch`
  - `comptroller.admin() == address(this)` → `ComptrollerAdminMismatch`
  - then store `ovrfloStream`.
- `setStreamNFTDescriptor(address descriptor)` — revert on zero or `descriptor.code.length == 0`, then `ISablierV2LockupLinear(ovrfloStream).setNFTDescriptor(descriptor)`. **No vault argument.** One lockup serves every registered vault.
- `registerOvrflo` reverts unless `factory.ovrfloStream()` is set and `vault.sablierLL() == factory.ovrfloStream()`. Candidate that binds a different stream → `StreamNotCanonical`. Unset canonical → its own revert (do not reuse `SablierMismatch`).
- `registerLending` verifies vault and lending bind the same stream (`SablierMismatch` keeps today's meaning) **and** that stream equals `factory.ovrfloStream()` (`StreamNotCanonical`). It does **not** re-check `stream.factory()`, `stream.admin()`, or `comptroller.admin()`.
- Each binding failure gets its own error. Do not absorb new checks into `SablierMismatch`.
- **No forwarders** for `transferAdmin` (lockup or comptroller), `setComptroller`, `claimProtocolRevenues`, `setProtocolFee`, `setFlashFee`, `toggleFlashAsset`. Add a test that the factory ABI has none of those selectors. Do not add a generic factory `execute`.
- Interface gains `burn(uint256)`, `isDepleted(uint256)`, `factory()`, `admin()`, `comptroller()`, `setNFTDescriptor`. Keep path `interfaces/ISablierV2LockupLinear.sol`.

### Settlement disposal (R17)

Run on every path that **returns** the NFT:

1. `close`
2. `repay` when remaining is zero

Do **not** run on `claim`. `claim` can empty the stream while the loan stays open. A later full repay then transfers the NFT without a draw of its own. That repay must still dispose.

Sequence:

1. Complete money movement first. Never decide the branch inside a draw.
2. If the stream reports empty, attempt burn **before** any transfer back (market must still own the token).
3. Burn is best-effort: if burn reverts for any reason, return the stream instead. Settlement money movement must not depend on disposal.
4. Otherwise transfer the NFT back (plain `transferFrom`, never `safeTransferFrom` — critical pattern #6).
5. Never derive the branch from a zero withdrawable or a zero outstanding — both are true of live streams, and burn would revert.
6. Keep `Closed(uint256 indexed loanId, uint128 drawn)`.
7. Also emit `StreamDisposed(uint256 indexed loanId, address indexed borrower, uint256 streamId, bool burned)` on **both** branches. A burn `Transfer` to `address(0)` does not carry the borrower. Foundry asserts the `StreamDisposed` topic.

### Mocks and fizz (SC10)

- `MockSablier` gains `burn` and `isDepleted`. Its `withdraw` latches depletion the way `SablierV2LockupLinear` does, or R17's branch cannot be exercised.
- `MockLendingSablier` gains the same two and stays a deliberate injection harness (do not replace it with real bytecode).
- Fizz: for every actor, `balanceOf` equals the suite's ownership-filtered mirror and `tokensOfOwnerIn(actor, 0, balanceOf)` is exactly that id set. Prune burned ids from `actorStreams` in the closure sweep, or `_actorStream`'s `ownerOf` reverts once R17 burns. Add a try-or-zero accessor and a burned-id set that the fizz helper and two invariant helpers skip.
- `Base.sol`'s "Sablier exposes no per-owner enumeration" comment becomes false — update it. The mirror is not a second source of truth.

### IERC4906 / mint gate / pretest

- Do not advertise IERC4906 in this repo's interface unless v1.1 already did (it did not).
- Mint gate stays `ovrfloInfo(msg.sender)` treasury != 0. No `setMinter` here either.
- SC11 pretest bytecode compare is ticket **08**. This ticket commits artifacts; 08 adds the runner.

## This ticket owns / does not own

**Owns:** three artifacts + provenance; interface members; vault constructor arg; factory `ovrfloStream` / `setOvrfloStream` / `setStreamNFTDescriptor` / registration checks / distinct errors; R17 on close and completing repay; mock extensions; fizz enumeration property; DeploySize re-measure; gas snapshot regen; U3 golden fixtures copied beside the artifact stamp for ticket 09; NatSpec at `OvrfloInfo` that treasury stays field 0 and names the off-repo consumer; ABI-shape test covering factory getter, this interface, and `StreamPricing.sol:9-19` (three hand-written copies).

**Does not own:** seed script / fork tests (06); audit docs / CONCEPTS.md rewrite (07); discovery / pretest compare (08); HTML card (09); E2E (10).

## Do not

- Compile the fork, submodule it, or `vm.etch` it
- Rename identifiers listed under R9
- Add `ovrfloStream()` on the vault
- Re-check `factory()` / `admin()` / `comptroller.admin()` inside `registerLending`
- Run R17 on `close` only, or on `claim`
- Derive burn from zero withdrawable / zero outstanding
- Let burn revert brick money movement
- Use `safeTransferFrom` for the stream NFT
- Add `transferAdmin` or fee forwarders or `execute`
- Give `setStreamNFTDescriptor` a vault argument
- Absorb new errors into `SablierMismatch`
- Replace `MockLendingSablier` with real bytecode
- Run `forge script --broadcast` against Anvil
- Edit the plan file
- Split this ticket into sub-tickets

## Implementation (binding)

1. Re-measure `test/DeploySize.t.sol` lending canary (declared 512 B). R17 spends from it. Record the new headroom; do not trust the declared figure.
2. Copy fork artifacts into `artifacts/` with provenance files (constructor args documented — SC23). Production and seed pass factory, never Safe, never deployer.
3. Stage U3 golden fixtures beside the stamp.
4. Extend `ISablierV2LockupLinear` with `burn`, `isDepleted`, `factory`, `admin`, `comptroller`, `setNFTDescriptor`.
5. Vault: constructor last arg `stream`; guards; delete inline hardcode.
6. Factory: storage `ovrfloStream`; `setOvrfloStream`; `setStreamNFTDescriptor`; registration checks per R19; four new errors; NatSpec on `OvrfloInfo`.
7. One test pins `ovrfloInfo(address)` selector and three-address return with `treasury` first, covering factory, fork interface field order, and `StreamPricing.sol:9-19`.
8. Lending: R17 helper used by `close` and by `repay` when `remaining == 0`. Emit `StreamDisposed`. Keep `Closed`.
9. Extend mocks. Fix fizz/invariant helpers for burned ids. SC10 property.
10. Test: factory ABI has no `transferAdmin` / fee-setter / `setComptroller` / `claimProtocolRevenues` selectors.
11. Update all vault constructor call sites.
12. Regenerate `.gas-snapshot` (Enumerable adds ~5 storage writes per mint; pledge/return touch it — even on the mock the lending paths change).
13. `foundry.toml` fs permissions for artifacts.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

### Resumption record (2026-08-15, finishing chat)

This is not a pre-code intent for an empty tree. A prior U5 chat aborted after
production writes. This session does not rewrite working `src/` that already
matches the plan.

**Already present (keep):**
- `artifacts/` lockup + comptroller + descriptor JSON, provenance, U3 goldens
- `foundry.toml` read `./artifacts`
- Vault: stream last ctor arg; `ZeroAddress` + `NoCode`; `sablierLL()` getter;
  no `ovrfloStream()` on the vault
- Factory: `ovrfloStream`; `setOvrfloStream`; `setStreamNFTDescriptor`; distinct
  errors; `registerOvrflo`/`registerLending` check canonical stream;
  `registerLending` does not re-check `factory()`/`admin()`/`comptroller.admin()`
- Lending: `_disposeStream` on `close` and completing `repay`; `StreamDisposed`;
  burn try/catch fallthrough; plain `transferFrom`; `isDepleted` branch
- Interface members `burn`/`isDepleted`/`factory`/`admin`/`comptroller`/`setNFTDescriptor`
- Mocks + fizz SC10 + `test/helpers/FactoryStreamBind.sol` (untracked)
- Factory/lending unit tests for AE6/AE8/AE9/AE10, ABI shape, residual repay,
  completing repay after claim, burn-revert settlement

**Gaps this session owns:**
1. `OVRFLOTestFixtures` still hardcodes canonical Sablier and skips
   `setOvrfloStream`. Bind a mock so `registerOvrflo` succeeds.
2. Re-measure lending DeploySize canary; record new headroom.
3. Regenerate `.gas-snapshot` (local; file is gitignored).
4. Confirm every `new OVRFLO(` passes stream last with `code.length > 0`.
5. Add a vault ABI check that `ovrfloStream()` is absent if missing.
6. `forge build` then `forge test`; invariant lending; `forge fmt --check`.
7. Commit via write-tree / commit-tree / update-ref. Do not push.

**Verification that will fail if U5 is wrong:**
- `registerOvrflo` without `setOvrfloStream` → `OvrfloStreamUnset`
- Vault ctor with `address(0)` / EOA → `ZeroAddress` / `NoCode`
- `registerLending` with a different stream than the vault → `SablierMismatch`
- `registerLending` with vault==lending stream but not `ovrfloStream` →
  `StreamNotCanonical`
- Completing `repay` after `claim` emptied the stream must burn (`burned=true`)
- Residual completing `repay` must return the NFT (`burned=false`)
- Burn revert must still settle and return the NFT
- Factory ABI has no `transferAdmin` / fee forwarders / `execute`
- `DeploySize` lending canary if R17 blew the EIP-170 reserve
- `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant`

**Owns vs later tickets:**
- 06: `seed-local.sh`, SeedRunner artifact deploy, fork tests vs real bytecode
- 07: `AGENTS.md`, `docs/agents/onboarding.md`, audit/CONCEPTS rewrite
- 08: discovery swap + pretest bytecode compare
- 09: HTML ledger card (goldens are only staged here)

**Predicted blast radius (this session's remaining writes):**
`script/lib/OVRFLOTestFixtures.sol`, `test/DeploySize.t.sol`,
`test/OVRFLO.t.sol` (vault ABI), `test/OVRFLOFactory.t.sol` (`execute` ABI if
missing), `.gas-snapshot` (local), this ticket file. Existing `src/` stays
unless verification proves a contradiction.

## Deviations from the plan

- Prior U5 chat aborted before intent/commits. Production writes already existed
  on `feat/u5-main-repo-rebind` when this session started. This session posts a
  resumption record rather than inventing a pre-code intent as if the tree were
  empty. The plan file is not edited.
- `script/lib/OVRFLOTestFixtures.sol` binds `MockSablier` (same admission shape
  as `FactoryStreamBind`) so `setOvrfloStream` + `registerOvrflo` succeed. Ticket
  06 owns `seed-local.sh` and real artifact deploy. Fork tests that still expect
  canonical Sablier v1.1 behavior stay ticket 06.
- `.gas-snapshot` is gitignored (`.gitignore:66`) and was never tracked. This
  session regenerates the local file. It does not force-add the ignored file.
- Owner scoped the U5 invariant gate to the default `[invariant]` profile
  (25 runs, depth 10): `forge test --match-contract OVRFLOLendingInvariant`.
  Do not run `FOUNDRY_PROFILE=invariant` (500 runs, depth 40). `foundry.toml`
  run counts are unchanged. The campaign is a drop-in stream-layer replacement;
  deep invariant is not required to prove U5. A finishing chat had already
  started a full-profile run before this scope; that run is not the gate.

## Final diff

- Predicted blast radius: artifacts (lockup, comptroller, descriptor +
  provenance + U3 goldens); `foundry.toml`; `interfaces/ISablierV2LockupLinear.sol`;
  `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `src/OVRFLOLending.sol`;
  `script/lib/OVRFLOTestFixtures.sol`, `script/lib/OVRFLOSeedRunner.sol`;
  `test/fizz/Base.sol`, `test/fizz/mocks/MockSablier.sol`;
  `test/mocks/LendingMocks.sol`, `test/helpers/LendingMockFixture.sol`;
  `test/DeploySize.t.sol`, `test/OVRFLO.t.sol`, factory/lending unit tests;
  `.gas-snapshot`.
- Actual (`git diff --stat main...HEAD` at `edc06d7`): 43 files,
  +7356 / −95. Artifacts + provenance + 12 goldens; `foundry.toml`; interface;
  vault/factory/lending; TestFixtures; DeploySize; factory/lending/fizz/mocks
  tests; new `test/helpers/FactoryStreamBind.sol`.
- Misses: `OVRFLOSeedRunner.sol` unchanged (calls TestFixtures; ticket 06 owns
  artifact deploy). `LendingMockFixture.sol` unchanged (`LendingMocks` already
  gained `burn`/`isDepleted`). `.gas-snapshot` regenerated locally; file is
  gitignored and was never tracked. Extra vs the plan file list: constructor
  sites in FlashLoan/Fuzz/Attack/WrapUnwrap/Invariant suites,
  `VaultMockHelpers`, fizz FoundryTester/Properties/handler, FactoryStreamBind.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] Three artifacts committed with GPL notices and provenance (constructor args listed)
- [x] Interface path and name unchanged; new members present
- [x] Vault constructs with `stream` last; `sablierLL()` still the getter; no `ovrfloStream()` on the vault; zero and code-less stream revert
- [x] `SablierMismatch` still fires when vault and lending bind different streams
- [x] `registerOvrflo` reverts when `factory.ovrfloStream()` is unset or the vault binds a different stream (Covers AE10)
- [x] `registerLending` reverts when the bound stream is not `factory.ovrfloStream()` (Covers AE10)
- [x] `registerLending` does not re-check `stream.factory()` / `admin()` / `comptroller.admin()`
- [x] `setOvrfloStream` reverts on a second call, zero, code-less, and each of factory/admin/comptroller-admin mismatch — each with its own error
- [x] ABI-shape test: `ovrfloInfo` selector and `(treasury, underlying, ovrfloToken)` order across all three hand-written copies; NatSpec at factory struct
- [x] Deposit from registered vault mints; `create*` from unregistered address reverts (Covers AE9 at unit level against factory + mock)
- [x] Covers AE8: owner updates descriptor through `setStreamNFTDescriptor`; direct lockup `setNFTDescriptor` from that owner reverts; factory ABI has no `transferAdmin`; zero or code-less descriptor reverts
- [x] Close emits `StreamDisposed` with borrower and burned flag on both branches (Covers AE6 at unit level)
- [x] Completing `repay` after `claim` emptied the stream burns and emits `StreamDisposed` with `burned = true`
- [x] Completing `repay` on a residual transfers the NFT back and emits `StreamDisposed` with `burned = false`
- [x] Burn that reverts still completes money movement and returns the stream (Covers AE6)
- [x] SC10 fizz property green; burned ids pruned; no `ownerOf` revert in helpers
- [x] `MockSablier` / `MockLendingSablier` names unchanged; `isDepleted` latches on withdraw
- [x] Existing unit/fuzz/invariant suites green against the mock
- [x] `forge build` then `forge test` green
- [x] `forge test --match-contract OVRFLOLendingInvariant` green (owner scoped to default 25/10; not `FOUNDRY_PROFILE=invariant`)
- [x] `forge build --sizes` diffed against pre-change values for the four existing deployables; lending canary re-measured
- [x] `.gas-snapshot` regenerated
- [x] U3 goldens staged for ticket 09
- [x] `forge fmt --check` clean

## Plan unit

U5 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
