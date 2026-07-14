---
title: OVRFLOFactory deployment and admin management pattern
date: 2026-06-27
category: docs/solutions/architecture-patterns/
module: OVRFLOFactory
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - Deploying or extending a factory contract that owns and administers child vaults and lending markets
  - Adding admin forwarding functions so all governance flows through a single factory entry point
  - Introducing reverse lookups, enumeration, and duplicate-prevention mappings for deployed vaults and lending markets
  - Making admin references immutable to save gas and enforce a single-owner admin model
tags:
  - ovrflofactory
  - factory-pattern
  - admin-forwarding
  - immutable-admin
  - deployment-management
  - reverse-lookup
  - duplicate-prevention
  - solidity
---

# OVRFLOFactory deployment and admin management pattern

## Context

OVRFLOFactory is the admin hub for every deployed OVRFLO vault and OVRFLOLENDING. It is owned by a timelocked multisig and is intended to be the **single admin entry point** for all vaults and lending markets: every governance action flows multisig -> factory -> vault (or lending market). A review of the factory's deployment and management surface revealed six concrete gaps where the implementation drifted from that intended design, from stale documentation describing features that were never built, to inconsistent admin routing that broke the single-surface invariant, to a missing duplicate-deployment guard that contradicted a documented fungibility guarantee.

These gaps were not theoretical. Each one was either actively misleading future developers (dead docs), creating operational risk (lending ownership drift on factory ownership transfer), or silently violating an invariant the project relied on (cross-market `ovrfloToken` fungibility under one underlying). The fix work touched `src/OVRFLOFactory.sol`, `src/OVRFLO.sol`, and a broad set of documentation and plan files, and was validated by 362 passing tests including 13 new ones targeting the gaps.

## Guidance

### 1. Do not let documentation describe features that do not exist

`transferVaultAdmin` / `transferOvrfloAdmin` was referenced in CLAUDE.md, README.md, audit methodology docs, plan docs, and brainstorm docs as an existing migration feature. It was never implemented. The `adminContract` storage variable in `OVRFLO.sol` was mutable but had no setter, so the "migration path" was a documentation phantom.

**Guidance**: Treat docs as code. When a feature is referenced anywhere, verify the symbol exists in the contract. If it does not, remove the reference from every file that mentions it, or implement the feature. Do not leave a half-state where a variable is mutable "for future migration" with no setter, because that invites both stale-doc drift and an unused mutability cost.

### 2. Route every dependent contract's admin actions through the factory

OVRFLOLENDING exposed `setAprBounds`, `setFee`, and `setTreasury` as `onlyOwner` on the lending market itself. The factory's `deployLending()` transferred lending ownership straight to the multisig:

```solidity
b.transferOwnership(owner()); // removed
```

This created two admin surfaces: vaults went multisig -> factory -> vault, but lending markets went multisig -> lending market directly. Worse, when the factory's own ownership was transferred via the two-step `transferOwnership` / `acceptOwnership` flow, lending ownership did **not** follow. The lending markets stayed owned by the old multisig address while the factory moved to the new one, silently splitting governance.

**Guidance**: If the factory is the single admin hub, the factory must **own** every dependent contract it deploys, and it must expose forwarding functions for every admin action on those dependents. Remove any `transferOwnership` to the multisig from inside `deployLending()`. Add thin forwarders that re-check the caller is the factory owner and re-emit an event:

```solidity
function setLendingAprBounds(address lending, uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setAprBounds(aprMinBps_, aprMaxBps_);
    emit LendingAprBoundsSet(lending, aprMinBps_, aprMaxBps_);
}

function setLendingFee(address lending, uint16 feeBps_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setFee(feeBps_);
    emit LendingFeeSet(lending, feeBps_);
}

function setLendingTreasury(address lending, address treasury_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setTreasury(treasury_);
    emit LendingTreasurySet(lending, treasury_);
}
```

Guard each forwarder with a known-lending check so a stale or arbitrary lending address cannot be driven through the forwarder:

```solidity
function _requireKnownLending(address lending) internal view {
    require(lendingToOvrflo[lending] != address(0), "OVRFLOFactory: unknown lending");
}
```

This keeps the multisig -> factory -> lending chain intact and means a single factory ownership transfer moves governance for vaults **and** lending markets in one step.

### 3. Provide reverse lookups and enumeration for every deployable contract type

The factory had `ovrfloToLending` (vault -> lending) but no reverse mapping and no enumeration for lending markets. Vaults had `ovrflos[uint256]` + `ovrfloCount`; lending markets had nothing. Off-chain tooling and on-chain readers could not list lending markets or answer "which vault owns this lending market?"

**Guidance**: For each deployable contract type, maintain the symmetric set of mappings:

```solidity
mapping(address => address) public ovrfloToLending;   // vault -> lending
mapping(address => address) public lendingToOvrflo;    // lending -> vault (reverse)
uint256 public lendingCount;                           // total deployed
mapping(uint256 => address) public lendings;           // index -> lending (enumeration)
```

Populate them together at deploy time so they can never drift:

```solidity
ovrfloToLending[ovrflo] = lending;
lendingToOvrflo[lending] = ovrflo;
lendings[lendingCount] = lending;
lendingCount += 1;
```

The reverse map doubles as the trust anchor for `_requireKnownLending`, so the enumeration and the admin-forwarder guard share one source of truth.

### 4. Enforce one-vault-per-underlying at configure time

`deploy()` did not check whether a vault already existed for a given underlying. A second `deploy()` for the same underlying would mint a second `OVRFLOToken` that was **not** fungible with the first vault's token. That directly contradicted the documented design feature "cross-market `ovrfloToken` fungibility under one underlying", which only holds **within** a single vault.

**Guidance**: Add an `underlyingToOvrflo` mapping and reject duplicate configuration before any deployment happens:

```solidity
require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed");
```

Set it only at deploy time, not at configure time, so that a pending config can be overwritten if the first attempt was never deployed:

```solidity
// in deploy()
underlyingToOvrflo[config.underlying] = ovrflo;
```

This lets operators reconfigure freely until they commit, and locks the underlying once a vault is live.

### 5. Document trust assumptions on sweep functions explicitly

`sweepExcessPt` and `sweepExcessUnderlying` intentionally omit zero-address validation on `to`, because the caller is the multisig (factory owner) and the project's stance is to trust what the multisig already validates rather than duplicate the check on-chain. That stance is correct for this project, but it is invisible to a reader of the code.

**Guidance**: Add a `@dev` natspec line stating the trust assumption and the reason, on both the factory and the vault:

```solidity
/// @dev `to` is trusted: the caller is the multisig (factory owner), so zero-address
///      validation is intentionally omitted per the project's stance of trusting what
///      the multisig already validates.
```

Documenting the **intentional** omission is as important as documenting the checks that are present. It stops a future contributor from "fixing" the missing validation and re-introducing redundancy, and it stops an auditor from flagging it as a finding.

### 6. Make constructor-set-once admin references immutable

`adminContract` was a mutable storage variable set once in the constructor and never changed. Every `onlyAdmin` call paid a ~2100-gas SLOAD instead of a ~3-gas immutable MLOAD, and the mutability implied a migration path that did not exist (see gap 1).

**Guidance**: If a reference is set in the constructor and never written again, declare it `immutable`. Rename it to reflect what it is, not a hypothetical future:

```solidity
address public immutable factory;
```

Update the modifier and constructor:

```solidity
modifier onlyAdmin() {
    require(msg.sender == factory, "OVRFLO: not admin");
    _;
}
// constructor
factory = admin;
```

Then sweep every doc, x-ray, plan, and brainstorm file for the old name and update them in the same change. An immutable reference is a design statement: "this never changes, by construction." Leaving it mutable is a silent invitation to add a setter later.

## Why This Matters

These six gaps share a root cause: the factory's **intended** design (single admin surface, one vault per underlying, immutable admin reference, documented trust model) had drifted from its **implemented** design, and the documentation had drifted further still, describing features that were never built. Each gap has a concrete cost:

- **Dead docs** mislead every new contributor and every auditor. An auditor who reads "vault admin migration via `transferVaultAdmin`" will look for the setter, not find it, and either flag a missing-feature finding or, worse, assume it exists and reason about its security properties. Removing the references closes that loop.
- **Split lending admin** means a factory ownership transfer silently abandons lending governance. In a timelocked-multisig context, discovering that lending markets are owned by the old multisig address **after** a rotation is an operational incident, not a refactor. Routing through the factory makes the rotation atomic.
- **Missing reverse lookup and enumeration** forces off-chain tooling to reconstruct state from events, which is fragile and easy to get wrong. The mappings are cheap (two SSTOREs at deploy time) and make the factory self-describing.
- **Duplicate underlying deployment** breaks a fungibility invariant the project explicitly relies on and documents as a feature. Two `OVRFLOToken` contracts for the same underlying are not fungible with each other, and a user who deposits into the second vault expecting parity with the first gets a different token. The guard turns a silent invariant violation into a loud revert.
- **Undocumented trust assumptions** look like bugs. An explicit `@dev` note converts a potential audit finding into a documented design choice and protects the omission from being "fixed" into redundancy.
- **Mutable admin reference** wastes gas on every admin-gated call and signals a migration path that does not exist. Making it immutable is both a gas win and a design assertion.

The unifying principle: **the factory's admin model must be consistent end-to-end**. If the factory is the single admin surface, then every dependent contract is owned by the factory, every admin action is forwarded through the factory, every deployable type is enumerable and reverse-mappable, every uniqueness invariant is enforced at the earliest possible point, and every intentional omission is documented. A gap in any one of those creates a seam that the next change will widen.

## When to Apply

Apply this guidance whenever you are designing or reviewing a **factory + dependent contract** pattern in Solidity, particularly when:

- The factory is owned by a timelocked multisig and is intended to be the **only** admin entry point for the contracts it deploys.
- Dependent contracts (vaults, lending markets, tokens, oracles) have their own `onlyOwner` admin functions that governance needs to call.
- The factory supports a two-step ownership transfer (`transferOwnership` / `acceptOwnership`), so ownership of dependents must move in lockstep.
- The same underlying asset must map to at most one vault, because downstream tokens or positions assume one-vault-per-asset fungibility.
- Off-chain tooling or on-chain readers need to enumerate deployed instances or resolve lending-to-vault / vault-to-lending relationships.
- A constructor-set reference is logically constant for the contract's lifetime.
- The project has an explicit stance of trusting multisig validation off-chain rather than duplicating it on-chain.

It does **not** apply when the factory is a thin deployer with no admin forwarding responsibility, when dependents are intentionally owned by distinct parties, or when the underlying-to-vault relationship is intentionally one-to-many. In those cases the single-surface invariant does not hold, and applying these patterns would add cost without value.

## Examples

### Before: split lending admin, no duplicate guard, mutable admin reference

```solidity
// OVRFLO.sol
address public adminContract; // mutable, no setter, ~2100 gas SLOAD per admin call

constructor(address admin, ...) {
    adminContract = admin;
}

modifier onlyAdmin() {
    require(msg.sender == adminContract, "OVRFLO: not admin");
    _;
}
```

```solidity
// OVRFLOFactory.sol
function deployLending(address ovrflo) external onlyOwner returns (address lending) {
    // ...deploy OVRFLOLENDING b...
    b.transferOwnership(owner()); // lending market owned by multisig directly, NOT the factory
    ovrfloToLending[ovrflo] = lending;  // forward map only, no reverse, no enumeration
    emit LendingDeployed(ovrflo, lending);
}

// deploy() has no check for an existing vault on the same underlying.
// setAprBounds / setFee / setTreasury on OVRFLOLENDING are onlyOwner on the lending market,
// so the multisig calls the lending market directly, bypassing the factory.
```

Documentation at this point claimed `transferVaultAdmin` existed for migration. It did not.

### After: single admin surface, duplicate guard, immutable reference

```solidity
// OVRFLO.sol
address public immutable factory; // immutable, ~3 gas MLOAD per admin call

constructor(address admin, ...) {
    factory = admin;
}

modifier onlyAdmin() {
    require(msg.sender == factory, "OVRFLO: not admin");
    _;
}
```

```solidity
// OVRFLOFactory.sol
mapping(address => address) public ovrfloToLending;     // vault -> lending
mapping(address => address) public lendingToOvrflo;      // lending -> vault
uint256 public lendingCount;
mapping(uint256 => address) public lendings;
mapping(address => address) public underlyingToOvrflo; // underlying -> vault

function configureDeployment(...) external onlyOwner {
    require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed");
    // ...store pending config...
}

function deploy() external onlyOwner returns (address ovrflo) {
    // ...deploy OVRFLO vault...
    underlyingToOvrflo[config.underlying] = ovrflo;
    // ...existing ovrflos[] enumeration...
}

function deployLending(address ovrflo) external onlyOwner returns (address lending) {
    _requireKnownOvrflo(ovrflo);
    require(ovrfloToLending[ovrflo] == address(0), "OVRFLOFactory: lending exists");
    // ...deploy OVRFLOLENDING b...
    // NOTE: no b.transferOwnership(owner()) — factory stays the owner
    ovrfloToLending[ovrflo] = lending;
    lendingToOvrflo[lending] = ovrflo;
    lendings[lendingCount] = lending;
    lendingCount += 1;
    emit LendingDeployed(ovrflo, lending);
}

function setLendingAprBounds(address lending, uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setAprBounds(aprMinBps_, aprMaxBps_);
    emit LendingAprBoundsSet(lending, aprMinBps_, aprMaxBps_);
}

function setLendingFee(address lending, uint16 feeBps_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setFee(feeBps_);
    emit LendingFeeSet(lending, feeBps_);
}

function setLendingTreasury(address lending, address treasury_) external onlyOwner {
    _requireKnownLending(lending);
    OVRFLOLENDING(lending).setTreasury(treasury_);
    emit LendingTreasurySet(lending, treasury_);
}

function _requireKnownLending(address lending) internal view {
    require(lendingToOvrflo[lending] != address(0), "OVRFLOFactory: unknown lending");
}
```

### Behavioral consequences

- A factory ownership transfer now moves governance for vaults **and** lending markets atomically. There is no separate "rotate lending ownership" step to forget.
- Calling `deploy()` twice for the same underlying reverts at `configureDeployment()` with `OVRFLOFactory: underlying already deployed`, preserving one-vault-per-underlying and the fungibility guarantee that depends on it.
- Reconfiguring a pending (never-deployed) config is still allowed: the guard only fires when a vault already exists for that underlying.
- `lendings(0)`, `lendings(1)`, ... and `lendingCount()` let off-chain tooling enumerate every lending market, and `lendingToOvrflo(lending)` resolves the owning vault in one call.
- Every admin-gated vault call reads `factory` as an immutable instead of a storage slot, saving ~2100 gas per call.
- A reader of `sweepExcessPt` sees the `@dev` note and understands the missing zero-address check is intentional, not an oversight.

### Test coverage that locks the invariants

Thirteen new tests were added alongside the fixes, covering: duplicate underlying prevention (revert on already-deployed, allow reconfigure if not deployed, allow different underlyings), lending admin forwarding (unauthorized callers revert, unknown lending reverts, forwarding succeeds and emits, lending `onlyOwner` reverts for non-factory callers), lending enumeration (multiple lending markets enumerated correctly), and the updated `deployLending` flow (factory remains owner, no pending owner nomination is left behind). All 362 tests pass.

## Related

- `docs/solutions/patterns/ovrflo-critical-patterns.md` — required-reading patterns for the project; patterns #5/#6 and rejected findings R-01/R-02 reference the same factory functions this work modified.
- `docs/solutions/architecture-patterns/ovrflobook-offer-market-active-gate.md` — documents the factory-as-lending-factory relationship; the admin boundary changed (factory now forwards lending admin and retains ownership).
- `docs/solutions/architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md` — references the factory immutable for wrap/unwrap reads; the `adminContract` -> `factory` rename is adjacent.
- `src/OVRFLOFactory.sol` — the factory contract where the forwarding functions, reverse lookup, enumeration, and duplicate-underlying guard live.
- `src/OVRFLO.sol` — the vault where `adminContract` was renamed to `immutable factory` and the `onlyAdmin` modifier was updated.
- `test/OVRFLOFactory.t.sol` — tests covering the new forwarding, enumeration, and duplicate-underlying behavior.
