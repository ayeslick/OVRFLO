---
title: "OVRFLOFactory mainnet code-size fix — register, don't construct - Plan"
type: fix
date: 2026-08-11
topic: factory-mainnet-code-size
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
deepened: 2026-08-11
---

# OVRFLOFactory mainnet code-size fix — register, don't construct - Plan

## Goal Capsule

**Objective.** Make the OVRFLO system deployable under real mainnet EVM rules (EIP-170 runtime cap 24,576 B; EIP-3860 initcode cap 49,152 B) by removing every embedded child-creation-code blob from `OVRFLOFactory`: children are deployed externally and the factory *registers* them after verifying, on-chain, every constructor-arg binding it previously guaranteed by construction. Three small child-constructor adaptations (U7, session-settled 2026-08-11) make the children safe to deploy externally — everything else in the children is untouched. Add a permanent in-suite size gate so this finding class cannot silently regress.

**Product authority.** The 2026-08-10 ticket-08 seed-smoke finding (recorded in `script/seed-local.sh`'s header); `docs/solutions/patterns/ovrflo-critical-patterns.md` #8 (factory owns every lending; admin is forwarded) and #9 (one vault per underlying); `docs/solutions/patterns/solidity-implementation-discipline.md` (minimality ladder, precedence rule); `docs/solutions/patterns/ovrflo-coding-standard.md` E1 (closed error/event catalog); the 2026-08-10 remediation-hierarchy directive (`.scratch/lending-v1-lite/issues/09-compound-and-codify.md`).

**Execution profile.** Solidity/Foundry plus shell/TS sync. Verify with `forge build` then `forge test` (repo preference). The plan-wide acceptance test is the seed smoke **without** `--disable-code-size-limit` (Verification Contract V5).

**Stop conditions.** Stop if correctness requires child changes beyond the three U7 constructor adaptations — anything touching child runtime behavior (deposit/wrap/claim/flash-loan/lending book logic) is outside this plan's authority. Stop if the post-U1 factory runtime measures above 16,384 B (double the projection; would mean the diagnosis is wrong). Stop if any Key Decision proves unimplementable rather than working around it.

**Open blockers.** None. Nothing is deployed to mainnet; this changes the launch deployment procedure, not a live system.

---

## Problem Frame

`OVRFLOFactory.deploy()` and `deployLending()` use `new`, so the creation code of all three children is embedded in the factory's own bytecode. The v1-lite lending rewrite pushed the total over the mainnet caps; only the ticket-08 Anvil seed smoke (the first environment enforcing real rules) caught it.

Measured at plan time (branch `codex/lending-v1-lite`, `optimizer_runs = 200`; the ticket's 50,609/50,122 figures predate the fdebe97 custom-error migration):

| Contract | Runtime (B) | Initcode (B) | Cap status |
|---|---|---|---|
| OVRFLOFactory | **47,890** | 48,278 | runtime **1.95× over** EIP-170; initcode 874 B under EIP-3860 |
| OVRFLO | 9,895 | 10,787 | fine (post-U7: initcode grows to ≈14.8 KB, runtime ~unchanged — see probe 2) |
| OVRFLOLending | 23,448 | 24,351 | runtime fine but only **1,128 B headroom**; initcode only **225 B** under EIP-170 |
| OVRFLOToken | 3,019 | 3,710 | fine (shrinks slightly under U7's deletions) |

Embedded child initcodes account for 10,787 + 3,710 + 24,351 = **38,848 B** of the factory's runtime; the factory's own logic is ≈ 9,042 B. No optimizer setting recovers 23 KB (runs are already at 200), so this is architectural.

**Probe 1 — the constraint that decides the architecture:** `OVRFLOLending`'s initcode (24,351 B) is itself only 225 B under EIP-170. *Any* contract whose **runtime** embeds it — factory or standalone deployer — is at or over the cap. Measured with a minimal one-function deployer probe compiled in this repo on 2026-08-11: the probe's runtime is **24,683 B — over EIP-170 by 107 B**. The "split deployer" direction is dead on arrival. (A vault+token deployer probe measured 15,297 B — it fits, but is moot once the lending deployer is impossible.)

**Probe 2 — creation-only `new` stays out of runtime:** a `new` that appears only in a constructor lands in the parent's *initcode*, not its deployed *runtime*. Measured 2026-08-11: a probe creating `OVRFLOToken` in its constructor has a **162 B runtime** (initcode 4,372 B), vs a **4,279 B runtime** when the same `new` sits in a regular function. This is the mechanism behind Key Decision 7(a): OVRFLO can construct its own token with zero runtime cost and ≈ +3.7 KB initcode, far under EIP-3860.

## Alternatives considered

- **A. Split deployer contracts** (factory keeps admin+registry; deployer contracts hold creation code). Measured dead: the minimal lending deployer is already 107 B *over* EIP-170 (probe 1). Even if lending were shaved under, the shape permanently halves lending's effective headroom — every future byte of `OVRFLOLending` growth also spends deployer headroom, and the ticket requires leaving lending room to grow. Rejected on measurement, not taste.
- **C. CREATE2 with creation code from calldata or SSTORE2-style code stores.** Works in principle (a pure data contract holding lending initcode fits at 24,352 B), but requires either the timelocked multisig pushing ~24–48 KB calldata blobs through Safe, or code-store pointer plumbing plus `Create2`/assembly deployment and codehash pinning. Heavy machinery; fails the minimality ladder at rungs 2 and 13. One honest credit: C is the only option that would have preserved **on-chain code identity** (codehash pinning of creation code). Option B gives that property up and resolves it off-chain instead — see the trust note in Design.
- **D. EIP-1167 minimal proxies + initializers.** Every child is constructor-initialized with public immutables; clones cannot use immutables, so all of that becomes storage, initializers become front-runnable surface, and the repo's "immutable, constructor-initialized, no proxies" stance (ladder rung 12; discipline doc) is inverted. Rejected.
- **E. Shrink the factory in place.** Deleting all staging logic recovers ≈ 2 KB of the needed ≈ 23 KB. The mass is the embedded initcode. Rejected on arithmetic.
- **H. Hybrid: factory keeps deploying vault+token, lending goes external.** Factory lands ≈ 23.5 KB — under the cap with ≈ 1 KB headroom that every future admin forwarder erodes, plus two deployment mechanisms. Rejected.
- **B. Register, don't construct — CHOSEN.** The factory embeds no creation code at all. Children are deployed by any EOA/script; the multisig registers them; registration verifies on-chain every constructor-arg binding the factory used to fix by construction. Factory runtime drops to ≈ 8–10 KB with no coupling between any contract's size and any other's, forever. This is the tier-1 remedy under the remediation hierarchy: the error class (child initcode inflating the factory) becomes **unrepresentable**, because the factory contains no initcode to inflate.

## Key Decisions

Decisions 1–6 are pinned recommendations settled by approval of this plan. Decisions 7–8 are session-settled. Decision 6 is severable (strikable without affecting the rest).

1. **Architecture B: the factory registers externally deployed children; it never constructs them.** (Chosen over A/C/D/E/H per the analysis above; A is excluded by measurement, not judgment.)
2. **The two-step `configureDeployment`/`deploy` staging is deleted**, along with `cancelDeployment`, the `DeploymentConfig` struct, `pendingDeployment`, errors `InvalidName`/`InvalidSymbol`/`NothingPending`, and events `DeploymentConfigured`/`DeploymentCancelled`. Staging existed to let the factory construct from stored config; with construction gone it guards nothing. The off-chain multisig registration checklist (documented in `registerOvrflo`/`registerLending` natspec) replaces construction-time guarantees the chain can no longer provide. Its **headline item is creation-code verification**: confirm each candidate's *deployment transaction* — initcode plus constructor args — matches the audited compiler artifact (`forge verify-bytecode` / source verification) before proposing registration. Creation-code, not runtime, comparison is required: runtime comparison masks immutable slots, and under Decision 7(a) the token's code identity lives in the vault's creation code, so creation-code verification transitively establishes it. This, not naming, is the real integrity item that moves off-chain (see the trust note in Design). Secondary items: token name/symbol carry the `"OVRFLO "`/`"ovrflo"` prefixes and fit 64/32 bytes; treasury and underlying values are the intended ones. Consistent with the house stance ("prefer off-chain multisig verification") and the existing off-chain total-supply check at `setLendingTickSpacing`. This changes the multisig runbook (see Deployment Runbook).
3. **Child deployment is permissionless; registration is `onlyOwner`.** Anyone can deploy candidate children (they can already — the source is public); only registration makes one real. Unregistered lookalikes are protocol-disconnected (see Security Analysis).
4. **Error/event catalog amendment** (coding-standard E1; this plan's approval is the dated decision):
   - New factory errors: `AlreadyRegistered`, `FactoryMismatch`, `OracleMismatch`, `OwnerMismatch`, `SablierMismatch`.
   - Reused existing factory errors (already declared today, no new declarations): `ZeroAddress`, `UnderlyingAlreadyDeployed`, `UnknownOvrflo`, `LendingExists` — the registration check tables revert with these.
   - Deleted factory errors: `InvalidName`, `InvalidSymbol`, `NothingPending`.
   - Deleted factory events: `DeploymentConfigured`, `DeploymentCancelled`.
   - Renamed factory events (Decision 6): `OvrfloDeployed` → `OvrfloRegistered`, `LendingDeployed` → `LendingRegistered` (argument shapes unchanged).
   - `OVRFLOToken` deletions (Decision 8): `transferOwnership`, event `OwnershipTransferred`, error `ZeroAddress` (its only use was in `transferOwnership`).
   - Everything else in the catalog is untouched.
5. **The permanent guard is a Foundry test asserting the mainnet caps** (`test/DeploySize.t.sol`, U2), not a CI job — this repo has no CI workflows, and `forge test` is the gate every session already runs. `forge build --sizes` is documented as the diagnostic table, not the gate. The test asserts hard caps for all four deployables plus one **headroom canary** for `OVRFLOLending` at 24,064 B runtime (512 B reserve; passes with U7's ≈ +30 B). The canary carries a `deliberate-ceiling` marker; raising it requires a recorded reason, not a silent bump.
6. **Event rename** (`*Deployed` → `*Registered`). The emission now marks registration, not construction; the old names would be lies. Honest cost: the U5 file set (web/tools verifier + tests) — touched by this plan anyway, and note the verifier's event-topic hash is **hardcoded keccak**, so it must be recomputed, not merely renamed. Strike this decision to keep the old names and drop the rename parts of U5; the U5 *semantics* fix (same-block verification) is required regardless.
7. **Child constructors are adapted for external deployment** (session-settled: user-directed 2026-08-11 — chosen over the zero-child-diff alternative of a `transferOwnership`/`acceptOwnership` two-step at registration plus freshness checks (`totalSupply()==0`, `nextPositionId()==1`, default-config assertions): that alternative closes the same windows at tier 2/3 — detection — where the constructor adaptation makes them unrepresentable, and the remediation hierarchy prefers tier 1):
   - **(a) `OVRFLO` constructs its own `OVRFLOToken`.** Constructor signature becomes `(admin, treasury, underlying, name_, symbol_, oracle)` — the token address argument is replaced by the name/symbol strings, and the `ovrfloToken` immutable is assigned from `address(new OVRFLOToken(name_, symbol_))`. The vault owns its token from the token's first instant: the deployer-owns-token window — in which a malicious deployer could **mint unbacked ovrfloToken supply** before handing over ownership, breaking the combined solvency invariant while passing every wiring check — cannot exist. Probe 2 proves the runtime cost is ~zero and the initcode cost ≈ +3.7 KB (fine under EIP-3860). Deployment wiring (`transferOwnership` call, token-owner registration check) is deleted rather than verified.
   - **(b) `OVRFLOLending`'s constructor gains one line: `_transferOwnership(factory_);`.** OZ 4.9's `Ownable` sets `owner = msg.sender`, so under external deployment the deployer EOA would own the lending — the registration check `owner() == factory` could never pass on an honest deployment, and the deployer-as-owner window would allow pre-registration calls to the **set-once** `setTickSpacing` (permanently uncorrectable by the factory), `setFee`, `setAprBounds`, `setTreasury`, and book opening. The one-line adaptation makes the factory the owner from birth, which is exactly what the constructor's existing natspec ("also the initial owner via Ownable2Step") already claims — the code finally matches its documentation. Note: construction now emits two `OwnershipTransferred` events (deployer, then factory) — pin this in event-assertion tests.
   - The same trick does **not** extend to the lending itself (vault cannot construct it): `OVRFLOLending`'s constructor requires its core to be already registered (`UnknownCore`), which necessarily post-dates vault registration.
8. **`OVRFLOToken` ownership becomes permanently immutable** (session-settled: user-directed 2026-08-11 — chosen over keeping `transferOwnership` as unreachable surface): with 7(a), no caller of `transferOwnership` can ever exist, so it is deleted along with `OwnershipTransferred` and the token's `ZeroAddress` error, and `owner` becomes an `immutable` set to `msg.sender` (the vault) at construction. YAGNI (ladder rung 2), cheaper `mint`/`burn` (no SLOAD), smaller token.

## Design

### Factory surface after the change

Deleted: `configureDeployment`, `cancelDeployment`, `deploy`, `deployLending`, `pendingDeployment`, `struct DeploymentConfig`, and the catalog items in Decision 4. Storage layout may change freely — nothing is deployed (but see U4: the fizz harness hardcodes factory storage slots and must migrate to real calls, not slot numbers). All registries, admin forwarders, `_requireKnownOvrflo`/`_requireKnownLending`, and the constructor stay as they are. The factory keeps importing `OVRFLO`/`OVRFLOToken`/`OVRFLOLending` for typed calls — importing a type embeds no creation code; only `new` does.

Added, in the old `DEPLOYMENT (TWO-STEP)` section's place (retitle the banner `REGISTRATION`):

```solidity
/// @notice Register an externally deployed OVRFLO vault with this factory.
/// @dev Off-chain multisig checklist before calling (not duplicated on-chain, per the
///      house stance): (1) the vault's deployment transaction (creation code + constructor
///      args) matches the audited compiler artifact — runtime-only comparison masks
///      immutable slots and misses the vault-created token; registration verifies
///      bindings, not code identity; (2) token name/symbol carry the "OVRFLO "/"ovrflo"
///      prefixes and fit 64/32 bytes; (3) treasury and underlying are the intended values.
function registerOvrflo(address ovrflo) external onlyOwner;

/// @notice Register an externally deployed OVRFLOLending with this factory.
/// @dev Same off-chain creation-code-verification checklist item as registerOvrflo.
function registerLending(address lending) external onlyOwner;
```

`registerOvrflo(address ovrflo)` — checks in order, then effects:

| # | Check | Reverts with | Replaces (construction-era guarantee) |
|---|---|---|---|
| 1 | `ovrflo != address(0)` | `ZeroAddress` | n/a (input hygiene) |
| 2 | `ovrfloInfo[ovrflo].treasury == address(0)` | `AlreadyRegistered` | registry rows written exactly once |
| 3 | `OVRFLO(ovrflo).factory() == address(this)` | `FactoryMismatch` | `new OVRFLO(address(this), …)` — pattern #8's admin root |
| 4 | `OVRFLO(ovrflo).oracle() == oracle` | `OracleMismatch` | factory passed its own `oracle` immutable |
| 5 | `underlyingToOvrflo[OVRFLO(ovrflo).underlying()] == address(0)` | `UnderlyingAlreadyDeployed` | pattern #9, previously enforced at `configureDeployment` |

Token ownership needs no check: under Decision 7(a) the vault constructs its token, so `token.owner() == vault` holds by construction for canonical bytecode — and canonicality itself is established off-chain (trust note below), so an on-chain owner check would verify nothing a lookalike couldn't fake. Token exclusivity across vaults also holds by construction (each vault creates its own token).

Effects (unchanged from `deploy()`): `ovrflos[ovrfloCount] = ovrflo; ovrfloCount += 1;` write `ovrfloInfo[ovrflo]` from the vault's immutables (`TREASURY_ADDR()`, `underlying()`, `ovrfloToken()`); write `underlyingToOvrflo`; emit `OvrfloRegistered(ovrflo, ovrfloToken, treasury, underlying)`.

`registerLending(address lending)` — checks in order, then effects:

| # | Check | Reverts with | Replaces |
|---|---|---|---|
| 1 | `lending != address(0)` | `ZeroAddress` | n/a |
| 2 | `core = OVRFLOLending(lending).core()` is registered (`_requireKnownOvrflo(core)`) | `UnknownOvrflo` | `deployLending`'s `_requireKnownOvrflo` |
| 3 | `ovrfloToLending[core] == address(0)` | `LendingExists` | 1:1 vault↔lending |
| 4 | `address(OVRFLOLending(lending).factory()) == address(this)` | `FactoryMismatch` | `new OVRFLOLending(address(this), …)` — registry reads route here |
| 5 | `OVRFLOLending(lending).owner() == address(this)` | `OwnerMismatch` | pattern #8: factory owns every lending — valid because Decision 7(b) sets owner at construction |
| 6 | `address(OVRFLOLending(lending).sablier()) == address(OVRFLO(core).sablierLL())` | `SablierMismatch` | `deployLending` read sablier from the vault |

**Reachability note (matters for U4):** checks 4–5 are unreachable only for lendings constructed against *this* factory. The realistic adversarial candidate is **genuine `OVRFLOLending` bytecode constructed against a hostile stub registry** that reports the real vault as registered: it constructs fine (`UnknownCore` consults only its own `factory_`), passes check 2 (the real vault *is* registered here), and passes off-chain code review of the runtime class — only its constructor args are hostile. Check 4 (`FactoryMismatch`) is the sole on-chain guard for that candidate class; these checks are load-bearing, not belt-and-suspenders. U4's `FactoryMismatch` test therefore deploys real `OVRFLOLending` bytecode against a minimal stub registry; the `OwnerMismatch`/`SablierMismatch` revert tests may use a mock lookalike exposing `core()/factory()/owner()/sablier()`.

Effects (unchanged from `deployLending()`): write `ovrfloToLending`, `lendingToOvrflo`, `lendings[lendingCount]`, increment; emit `LendingRegistered(core, lending)`.

**Constructor-arg completeness (and its limit).** Every constructor argument the factory used to supply is exposed by the child as a public immutable, so registration verifies *exactly* the constructor-arg bindings construction fixed:

- `OVRFLO(admin, treasury, underlying, name_, symbol_, oracle)` → checks 3, 4, 5 + `TREASURY_ADDR()` stored; `treasury`/`underlying`/name/symbol *values* are multisig-reviewed off-chain, the same trust they carried as `configureDeployment` arguments. The token is not an argument (Decision 7(a)) — its wiring is unrepresentable-wrong.
- `OVRFLOLending(factory_, core_, sablier_)` → checks 4+5 (7(b) makes `factory_` set both the registry pointer and the owner), 2, 6. Its `underlying`/`ovrfloToken` immutables are self-derived in its constructor from this factory's registry (reverting `UnknownCore` if `core` isn't registered) — which forces the deploy **ordering**: the vault must be registered before the lending can be constructed.

**Trust note — code identity moves off-chain.** The old flow guaranteed one thing registration cannot: the children's *bytecode* (the factory `new`ed audited code). Registration interrogates getters on whatever code lives at the address; a lookalike answering all checks correctly passes. This is not fixable on-chain — immutables are baked into runtime code, so there is no single pinnable codehash per contract class. It is resolved by the off-chain checklist's creation-code-verification item (Decision 2), consistent with the house off-chain-multisig stance. This is the one property Option C would have kept on-chain (see Alternatives).

### Deployment runbook (replaces the old configure→deploy→deployLending flow)

1. Deployer EOA/script: `new OVRFLO(factory, treasury, underlying, "OVRFLO <Name>", "ovrflo<SYM>", oracle)` — the vault constructs and owns its token internally.
2. Multisig (timelocked): `factory.registerOvrflo(vault)` (after off-chain bytecode verification).
3. Deployer EOA/script: `new OVRFLOLending(factory, vault, sablier)` (reverts `UnknownCore` unless step 2 landed; owner is the factory from birth).
4. Multisig (timelocked): `factory.registerLending(lending)`.
5. Onboarding continues unchanged: `prepareOracle`, `addMarket`, `setLendingTickSpacing`, limits/fees.

Multisig transaction count *drops* from three (configure, deploy, deployLending) to two; steps 1 and 3 are single transactions each and need no timelock because they create nothing the system trusts yet.

### Security analysis

- **Rogue vaults are protocol-disconnected, not inoperable.** A stranger can deploy a vault with `admin = attacker` and fully operate it — approve series, mint its own token. It is inert *with respect to the real system* because it is economically and structurally disconnected: its ovrfloToken is a distinct contract nobody registered; its Sablier streams have `stream.sender == rogueVault`, which fails the real lending's eligibility check (`StreamPricing.requireEligible` verifies the stream sender is the lending's own `core`); and registration check 3 (`factory() == this`) excludes it from the registry. Note the eligibility gate reads the **core vault's** `series` mapping — the factory-registry gates live at `addMarket` and the admin forwarders.
- **Rogue lendings are inert.** With 7(b), a stranger-deployed `OVRFLOLending(realFactory, realVault, anySablier)` is owned by the real factory from birth. Every activation path needs `setTickSpacing` (owner-only), and the factory's forwarder gates on `_requireKnownLending` — unregistered ⇒ spacing permanently unset ⇒ `supply` reverts `SpacingUnset` ⇒ the book can never open. A lending deployed with genuine bytecode against a *fake/stub* registry is owned and configured by whoever controls the stub, and can even operate a parallel book against the real vault's streams — it is a non-threat for the same reason as any lookalike (unregistered, no factory endorsement, no discovery surface routes users to it), and check 4 (`FactoryMismatch`) excludes it from registration even though its bytecode is genuine (see the Design reachability note).
- **Ownership.** The factory owns every real lending from construction (7(b)); no `transferOwnership`/`acceptOwnership` code path exists in the factory, so ownership cannot move. Token ownership is immutable (Decision 8).
- **Pre-registration state is harmless by construction.** The token can only mint via the vault, and pre-registration the vault's only mint path is `wrap` — which is 1:1 backed by the wrap reserve (deposits need an approved series, impossible pre-registration). Lending config and book activity are unreachable pre-registration (previous bullets). No freshness checks are needed; the windows the review found (unbacked pre-mint, pre-set set-once tick spacing) are closed at tier 1 by Decision 7, not detected at tier 3.
- **No registration front-run exists.** Registration is `onlyOwner`; every checked property is either immutable (`factory()`, `oracle()`, `underlying()`, `TREASURY_ADDR()`, `core()`, `sablier()`) or only-multisig-writable (the registry mappings). No state a non-owner controls can flip a check between timelock queue and execution.
- **Pattern #9 timing.** The duplicate-underlying guard now fires at registration instead of configuration. Competing *candidates* for one underlying can coexist unregistered; the registry accepts exactly one — same end state.

### Remediation tiers (per the 2026-08-10 directive)

- **Tier 1 (the fix):** no contract embeds another's creation code in its *runtime* ⇒ the size-blowup class is unrepresentable. Decision 7 extends tier 1 to the external-deployment windows: wrong token ownership, unbacked pre-mint, deployer-owned lending, and pre-registration config are all unrepresentable, not checked.
- **Tier 3 (the regression gate, U2):** `test/DeploySize.t.sol` asserts, for each of `OVRFLOFactory`, `OVRFLO`, `OVRFLOToken`, `OVRFLOLending`: `vm.getCode("<C>.sol:<C>").length <= 49_152` and `vm.getDeployedCode("<C>.sol:<C>").length <= 24_576`; plus the lending canary `<= 24_064` with `// deliberate-ceiling: 512 B EIP-170 headroom reserve; revisit when this assertion fires — shrink or bump with a recorded reason`. Tier 3 is the strongest available tier for the *residual* risk (a contract organically outgrowing its own cap). Both cheatcodes were empirically verified in this repo under the current `foundry.toml` (no fs-permission changes needed), and `vm.getDeployedCode` returns the runtime blob with zeroed immutable slots — identical length to deployed code.
- **Workaround retirement:** `--disable-code-size-limit` is removed from the seed flow (U3); from then on every local seed re-proves mainnet deployability (the environment-fidelity gate).

---

## Implementation Units

### U7. Child constructor adaptations (Decisions 7–8)

**Goal:** make the three children safe and correct to deploy externally; no runtime-behavior change.
**Dependencies:** none — lands first.
**Files:** `src/OVRFLO.sol`, `src/OVRFLOToken.sol`, `src/OVRFLOLending.sol`; touched tests live in U4.
**Approach:**
- `src/OVRFLOToken.sol`: `owner` becomes `address public immutable owner` assigned `msg.sender`; delete `transferOwnership`, `OwnershipTransferred`, `ZeroAddress`. `NotOwner`, `mint`, `burn` unchanged.
- `src/OVRFLO.sol`: constructor signature `(admin, treasury, underlying, name_, symbol_, oracle)`; assign `ovrfloToken = address(new OVRFLOToken(name_, symbol_))`; delete the old token-address parameter and its zero-check; natspec updated (vault creates and permanently owns its token).
- `src/OVRFLOLending.sol`: add `_transferOwnership(factory_);` at the end of the constructor; the line-314 natspec ("also the initial owner via Ownable2Step") becomes accurate and stays.
**Test scenarios (U4 carries the files):**
- Vault construction: `token.owner() == address(vault)`, `vault.ovrfloToken()` has code, token name/symbol equal the passed strings exactly.
- Lending construction **from a plain EOA** (no prank-as-factory): `lending.owner() == factory` — the scenario that exposed the OZ-4.9 `msg.sender` ownership premise.
- Construction event pin: lending construction emits two `OwnershipTransferred` events (→deployer, →factory).
**Verification:** `forge build` clean; post-change measurements recorded — OVRFLO runtime ~unchanged and initcode ≈ 14.8 KB (probe 2 predicts this), OVRFLOLending runtime + ≈ 30 B (canary still passes), OVRFLOToken runtime shrinks.

### U1. Factory rewrite

**Goal:** the factory registers instead of constructing; embeds zero creation code.
**Dependencies:** U7 (registration checks reference the adapted constructors).
**Files:** `src/OVRFLOFactory.sol` (unit tests in U4).
**Approach:** delete/add exactly per Design. Contract-level `@dev` gains one sentence ("Children are deployed externally and registered after on-chain verification; the factory embeds no child creation code — EIP-170"); register functions carry the off-chain checklist `@dev` shown in Design, bytecode verification first.
**Verification:** `forge inspect OVRFLOFactory deployedBytecode` length ≤ 12,288 B (expected ≈ 8–10 KB).

### U2. Size gate

**Goal:** this finding class cannot silently regress.
**Dependencies:** U1, U7 (measures final artifacts).
**Files:** new `test/DeploySize.t.sol`.
**Approach:** per Remediation tiers — four contracts × two caps + the lending canary; `vm.getCode`/`vm.getDeployedCode` only (first use in this repo; empirically verified to work), no deployment, no fixtures.
**Test scenarios:** the assertions are the scenarios. Adversarial-strength criterion: temporarily lowering any cap constant by 1 below the corresponding measured size must turn the suite red (state in a comment; do not commit the mutation).

### U3. Scripts and fixtures

**Goal:** every deploy/seed path follows the new runbook; the workaround flag dies everywhere.
**Dependencies:** U1, U7.
**Files:** `script/lib/OVRFLOTestFixtures.sol`, `script/lib/OVRFLOSeedRunner.sol`, `script/seed-local.sh`, `tools/scripts/bootstrap-local.sh`, `web/package.json`, `script/OVRFLO.s.sol` (comment only).
**Approach:**
- `_deployConfiguredSystemAs`: `new OVRFLOFactory(owner, address(ORACLE))`; `new OVRFLO(address(factory), TREASURY, WSTETH, "OVRFLO Wrapped Staked Ether", "ovrfloWSTETH", address(ORACLE))` (exact strings — they reproduce what the old factory prepending produced, so no downstream name/symbol expectation moves); `factory.registerOvrflo(address(ovrflo))`; `token = OVRFLOToken(ovrflo.ovrfloToken())`. Caller context (prank/broadcast as owner) already satisfies `onlyOwner`.
- `OVRFLOSeedRunner`: same replacement; `deployLending` call sites become `new OVRFLOLending(address(factory), address(ovrflo), sablier)` + `factory.registerLending(...)` (sablier read from the vault as before).
- `script/seed-local.sh`: runbook order via `forge create`/`cast send` (pattern #2 unchanged); `NAME_SUFFIX`/`SYMBOL_SUFFIX` become the full strings above; vault/lending addresses come from `forge create` output, with the old `ovrflos(0)`/`ovrfloToLending` reads kept as post-registration verification; delete the `--disable-code-size-limit` requirement and rewrite the header's finding paragraph as a resolved reference to this plan.
- Flag sweep (pinned hits): `script/seed-local.sh` (usage header), `tools/scripts/bootstrap-local.sh:61` (anvil launch), `web/package.json` `anvil:fork` script. `docs/agents/testing.md` and `web/tests/e2e/README.md` have zero hits — no action.
- `script/OVRFLO.s.sol`: logic unchanged (deploys only the factory); its manifest comment encodes both the old event name and the same-block verification premise — update alongside U5's semantics.
**Verification:** V5 seed smoke end-to-end without the flag.

### U4. Test-suite sync

**Goal:** the suite proves the registration surface and migrates every factory-deploy call site.
**Dependencies:** U1, U7.
**Files:** `test/OVRFLOFactory.t.sol`, `test/OVRFLO.t.sol` (constructor-shape tests), `test/OVRFLOToken.t.sol`, `test/OVRFLOLending.t.sol`, `test/OVRFLOLendingInvariant.t.sol`, `test/OVRFLOInvariant.t.sol:254-257`, `test/OVRFLOWrapUnwrap.invariant.t.sol:158-161`, `test/OVRFLOFuzz.t.sol:62-64`, `test/OVRFLOAttackScenarios.t.sol:129-131,581`, `test/OVRFLOFlashLoan.t.sol:159-161,442-444,770`, `test/OVRFLOWrapUnwrap.t.sol:70-73,97-100,216-219,300`, `test/helpers/LendingMockFixture.sol:52-53`, `test/fork/OVRFLOLendingMainnetFork.t.sol:290-291`, `test/fizz/Base.sol`, `test/fizz/harness/OVRFLOLendingHarness.sol` (natspec), `test/fizz/README.md`, plus the U7 scenarios.
- **Ownership pin (Decision 7(b) fallout):** the owner of every *directly-constructed* lending is now the `factory_` constructor argument, not the deploying test contract. Every direct owner call (`setTickSpacing`/`setAprBounds`/`setFee`/`setTreasury`) in `test/helpers/LendingMockFixture.sol:52-53`, `test/OVRFLOLending.t.sol`, `test/OVRFLOLendingInvariant.t.sol:1356-1357`, `test/fork/OVRFLOLendingMainnetFork.t.sol:290-291`, and `test/OVRFLOAttackScenarios.t.sol:581` must be issued as that factory address (`vm.prank`), and the two fixture natspec comments claiming "the test contract deploys the book, so it owns it" must be updated. Gas numbers in `test/OVRFLOLendingGas.t.sol` will churn from the fixture reshaping — snapshot noise, not correctness.
- **Constructor-migration pin (Decisions 7(a)/8 fallout):** every `new OVRFLOToken(...)` / `new OVRFLO(..., token, ...)` / `token.transferOwnership(vault)` triple in the files above migrates to the 6-arg vault constructor with the token read back via `ovrflo.ovrfloToken()` and the `transferOwnership` line deleted. In `test/OVRFLOToken.t.sol`, delete the two `transferOwnership` tests (constructor/mint/burn tests survive — the immutable `owner` getter still satisfies them).
**Approach — pinned registration test list** (house style: `test_Fn_Behavior`, exact-selector `expectRevert`, OZ-4.x `"Ownable: caller is not the owner"` string for unauthorized callers; registration knows all addresses beforehand, so events assert **all topics** — `expectEmit(true,true,true,true, address(factory))`, unlike old `deploy()`):
1. `test_RegisterOvrflo_RevertsForUnauthorizedCaller`
2. `test_RegisterOvrflo_RevertsForZeroAddress`
3. `test_RegisterOvrflo_RevertsWhenAlreadyRegistered`
4. `test_RegisterOvrflo_RevertsForFactoryMismatch` — vault constructed with a different admin
5. `test_RegisterOvrflo_RevertsForOracleMismatch` — vault constructed with a different oracle
6. `test_RegisterOvrflo_RevertsForDuplicateUnderlying` — pattern #9 at registration
7. `test_RegisterOvrflo_StoresAccountingAndEmits` — all-topic `OvrfloRegistered`; assert `ovrfloCount`, `ovrflos(0)`, all `ovrfloInfo` fields, `underlyingToOvrflo` (successor of `test_Deploy_DeploysSystemStoresAccountingAndTransfersTokenOwnership`, minus the prepend assertions that die with Decision 2)
8. `test_RegisterLending_RevertsForUnauthorizedCaller` (+ swap the deleted entries in `test_OwnerOnlyFunctions_RevertForUnauthorizedCallers` for the two register functions)
9. `test_RegisterLending_RevertsForZeroAddress`
10. `test_RegisterLending_RevertsForUnknownCore` — mock lookalike whose `core()` is unregistered
11. `test_RegisterLending_RevertsWhenLendingExists`
12. `test_RegisterLending_RevertsForFactoryMismatch` — real `OVRFLOLending` constructed against a minimal stub registry reporting the real core as registered (the realistic adversarial candidate; see Design reachability note)
13. `test_RegisterLending_RevertsForOwnerMismatch` — mock lookalike
14. `test_RegisterLending_RevertsForSablierMismatch` — mock lookalike
15. `test_RegisterLending_StoresAccountingAndEmits` — all-topic `LendingRegistered`; assert both mappings, `lendings(0)`, `lendingCount`
16. `test_RegisterLending_SucceedsFromEoaDeployedLending` — the **end-to-end happy path with the lending deployed by a plain EOA, no pranks-as-factory** (the shape that exposes ownership-model regressions; owner-pranked fixtures mask them)
17. `test_RegisterLending_UnregisteredLendingStaysInert` — real unregistered lending: `factory.setLendingTickSpacing` reverts `UnknownLending`, `supply` reverts `SpacingUnset`
18. `test_RegisterLending_ConstructionRevertsForUnregisteredCore` — pins the runbook ordering (`UnknownCore`)
19. `test_Lending_RogueVaultStreamIsIneligible` — a rogue vault's stream pledged to the real lending fails eligibility (asserts the true disconnection mechanism from Security analysis)
- **`test/fizz/Base.sol` is NOT a mechanical migration:** it replays `deployLending`'s registry writes via `vm.store` against **hardcoded factory storage slots 12–15**; deleting `pendingDeployment` shifts every slot and would silently corrupt state. Replace the whole `vm.store` block with a real `factory.registerLending(address(harnessMarket))` call — the harness already satisfies all six checks — and drop the slot-layout comment. Also delete the ownership hand-over at `test/fizz/Base.sol:251-253` (`harnessMarket.transferOwnership(address(factory))` plus the pranked `acceptOwnership`) and update the adjacent step comment: under Decision 7(b) the harness is factory-owned from construction, so the hand-over both reverts and guards nothing.
- Doc refresh in this unit: critical patterns `#8` — its detection grep is **shape-changed**, from "deployLending must NOT call transferOwnership" to asserting the presence of registration check 5 (`owner() == address(this)`); `#9` — rewrite the "mapping is set at deploy() time" timing paragraph per the plan's Pattern #9 timing analysis; refresh `docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md` with a dated successor note.
**Verification:** full suite green including `FOUNDRY_PROFILE=invariant`.

### U5. Web/tools sync

**Goal:** ABI regen plus the deployment-artifact verifier survives the two-transaction deploy.
**Dependencies:** U1.
**Files:** `web/lib/generated.ts` (regen via `npm --prefix web run typegen`), `web/lib/deployment.ts`, `tools/scripts/write-deployment-artifact.mjs`, `web/tests/lib/deployment.test.ts`, `web/tests/scripts/deployment-artifact.test.ts`.
**Approach:** the verifier currently requires the lending event's block to **equal** the lending's code-deployment block — under the new flow `new OVRFLOLending` and `registerLending` land in different transactions/blocks, so every seed would fail verification. Pinned semantics: **anchor the artifact to registration** — `lendingDeploymentBlock`/`lendingTransactionHash` are the `registerLending` event's block/tx; the verifier requires the event to exist at that block *and* the lending to already have code at that block (`eventBlock >= codeBlock` replaces equality). `web/lib/deployment.ts`'s equality check against the artifact block then still holds. If Decision 6 stands: recompute the **hardcoded** `LENDING_DEPLOYED_TOPIC` keccak in `write-deployment-artifact.mjs` for `LendingRegistered(address,address)` (a rename is not sufficient); `web/lib/deployment.ts` uses a `parseAbiItem` string, where rename suffices.
**Test scenarios:** both existing test files updated to the new anchor semantics — one case where create-block < event-block passes; one where the event is missing at the anchored block fails.
**Verification:** `npm --prefix web run test` green.

### U6. Docs sync

**Goal:** no live doc describes the factory as constructing children.
**Dependencies:** U1 (content), any order otherwise.
**Files (pinned by sweep):** `AGENTS.md` (Architecture Overview factory paragraph, Security Features list, Development Commands gains `forge build --sizes`; also correct the pre-existing stale Learned Workspace Fact "there is no hardcoded `PENDLE_ORACLE` in the factory" — the factory carries a factory-wide `oracle` immutable today, and registration check 4 relies on it — user decision 2026-08-11), `AUDIT.md` (entry-point matrix rows for `configureDeployment`/`cancelDeployment`/`deploy`/`deployLending` → register functions), `x-ray/x-ray.md` ("Two-step deployment" row), `x-ray/entry-points.md`, `x-ray/invariants.md` (X-3/X-5 prose; X-5's stale `OVRFLOFactory.sol:187` citation becomes "registration verifies token ownership by construction — Decision 7(a)"), `docs/solutions/patterns/ovrflo-style-guide.md` (the line recording the `--disable-code-size-limit` workaround), `README.md` (entry-point table rows at lines 158–160, the name/symbol-at-`configureDeployment` description at line 195, the worked deploy example at lines 369–386, and the line-71 architecture diagram's `deploy()` label — all rewritten to the register runbook). Zero hits (verified, no action): `CONCEPTS.md`, `docs/maps/`. Historical files (old plans, dated writeups, `.scratch/` tickets, `docs/audit/` records) are intentionally left alone.
**Test expectation: none** — documentation-only unit; the DoD grep is its verification.

### Sequencing

U7 → U1 → (U2, U3, U4 in any order) → U5 → U6. Single branch; commit per unit per house convention.

---

## Verification Contract

- V1. `forge build` clean, then `forge test` green (repo order).
- V2. `test/DeploySize.t.sol` present and green; mutation check per U2 performed once and reported.
- V3. `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` green (fixture flow changed under it).
- V4. Fork tests: `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` green (skip-safe without RPC).
- V5. **Acceptance:** `anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1` **without** `--disable-code-size-limit`, then `bash script/seed-local.sh` end-to-end green — the exact environment that caught the finding now passes under real rules, including the two-transaction lending verification (U5 semantics).
- V6. `npm --prefix web run test` green after typegen.
- V7. Measured sizes reported in the PR description: factory runtime/initcode before→after; OVRFLO initcode delta; OVRFLOLending runtime delta vs the canary; all four deployables' headroom.

## Definition of Done

All units landed; V1–V7 green; `rg -n "configureDeployment|deployLending|pendingDeployment|disable-code-size-limit|transferOwnership" src/ script/ tools/ web/ x-ray/ AUDIT.md AGENTS.md README.md` returns only intended registration-era content (lending's constructor `_transferOwnership` and OZ internals are expected hits); critical patterns #8/#9 refreshed with new citations; child diffs limited to the three U7 constructor adaptations.

## Decisions requiring user sign-off

Settled 2026-08-11 during interactive review (session-settled: user-directed): **7** (child constructor adaptations) and **8** (token ownership immutable). The rest are pinned recommendations; approval of this plan settles them:

1. Architecture B — register, don't construct (Key Decision 1).
2. Delete the configure/deploy staging; the off-chain checklist's headline item is bytecode verification against audited artifacts, with name/symbol review secondary (Key Decision 2 — changes the multisig runbook).
3. Permissionless child deployment, `onlyOwner` registration (Key Decision 3).
4. The error/event catalog amendment as listed (Key Decision 4).
5. Size gate as a Foundry test with a 512 B lending headroom canary at 24,064 B (Key Decision 5).
6. Event renames `*Deployed` → `*Registered` — severable; strike to keep the old names (the U5 same-block semantics fix is required either way) (Key Decision 6).
