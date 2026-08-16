# 02 — ERC721Enumerable + mint gate

**What to build:** Linear lockup enumerates ownership on-chain. Every `create*` admits only a registered OVRFLO vault. Withdraw and transfer semantics stay v1.1. Solidity name stays `SablierV2LockupLinear`. Delete `Precompiles.sol`. Do not change ERC721 `name`/`symbol` (ticket 03 owns that).

**Repo:** sibling `OVRFLO-Streams`. Work on a branch from `fork/bring-up`. This OVRFLO repo is read-only for this ticket.

**Blocked by:** 01 (resolved)

**Status:** resolved (head `93583f3bf08b107dbabcacc15725ab26c76fac70` on `feat/u2-enumerable-mint-gate`)

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/02-erc721enumerable-and-mint-gate.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Repo: sibling OVRFLO-Streams. Do not compile the fork inside OVRFLO.
Do not edit the plan. Do not start U3 (descriptor / ERC721 name-symbol) or U4–U10.
Before any code, read Required reading and the plan sections: Goal Capsule,
Product Contract (R1, R2, R2b, R2c, R3, R7, R7b, OQ5), Planning Contract
(KTD1, KTD3, KTD5), Sweep SC1, SC5–SC7, and ### U2.
First commit: delete test/utils/Precompiles.sol and its test (SC1).
Do not touch ERC721("Sablier V2 Lockup Linear NFT", ...) constructor calls.
Do not add setMinter. Do not advertise IERC4906.
Honor stop conditions: if Enumerable changes withdraw/transfer, or v1.1
withdraw ACL cannot stay byte-for-byte, surface and stop.
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
- Plan Goal Capsule stop conditions; R1, R2, R2b, R2c, R3, R7, R7b; OQ5; KTD1, KTD3, KTD5; SC1, SC5–SC7; ### U2
- `src/OVRFLOFactory.sol` struct `OvrfloInfo` field order (`treasury`, `underlying`, `ovrfloToken`) and `_requireKnownOvrflo` — the mint gate copies that predicate. Read those lines. Do not import this repo into the fork.
- `docs/audit/sablier-interface-contract.md` (withdraw ACL the body must not change)
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

Copy these into the work. Do not invent a different mint gate or a rename.

- **R1 / R9 naming.** Solidity contract is `SablierV2LockupLinear`. Comptroller is `SablierV2Comptroller`. `OVRFLOStream` is the deployed ERC721 identity only. Do not rename files, types, errors, NatSpec, or comments. `forge inspect` uses `SablierV2LockupLinear`, not `OVRFLOStream`.
- **KTD5 timing.** ERC721 `name`/`symbol` stay `"Sablier V2 Lockup Linear NFT"` / `"SAB-V2-LOCKUP-LIN"` in this ticket. The upstream descriptor still dispatches on the symbol. Changing the symbol here reverts every `tokenURI`. Ticket 03 changes the strings after it deletes that descriptor. Do not touch LockupDynamic's `ERC721(...)` call either.
- **R2b mint gate.** At the start of every `create*` (Linear `createWithDurations` / `createWithRange`, and LockupDynamic's two), view-call `IOVRFLOFactoryRegistry(factory).ovrfloInfo(msg.sender)` and revert when `treasury == address(0)`. `msg.sender` is the vault. The stream contract is not in `ovrfloInfo`. There is no `minter` storage and no `setMinter`. Do not pin `params.sender` or `params.asset`. Withdraw, transfer, approve, and burn gain no new caller check.
- **Factory immutable.** `address public immutable factory`, set from the same constructor argument as `initialAdmin`. Getter is `factory()`. The fork declares its own `src/interfaces/IOVRFLOFactoryRegistry.sol` with one getter `ovrfloInfo(address)` returning `(address treasury, address underlying, address ovrfloToken)` in that order. The fork does not import this OVRFLO repo.
- **R2c tests.** Inherited create tests deploy a mock registry as `factory` / `initialAdmin`. That mock returns a non-zero treasury for any non-zero argument. Production `ovrfloInfo` returns zeros for an unknown vault. Inherited tests never talk to `OVRFLOFactory`.
- **R3.** Withdraw ACL stays byte-for-byte: sender, NFT owner, or approved operator only. Stop if Enumerable forces a change.
- **OQ5.** `supportsInterface` reports ERC721, ERC721Metadata, and ERC721Enumerable. `IERC4906` stays unadvertised / false, matching v1.1. Do not add it.
- **OQ4.** This OVRFLO repo does not compile the fork, vendor it, or choose its package manager.
- **R7 / R7b.** New tests for Enumerable, the mint gate, and the size gate use a standalone harness. Do not import upstream `test/Base.t.sol` or `test/utils/Defaults.sol` (UNLICENSED). Inherited suite is a local-only gate.
- **R17 / R19** are ticket 05 (this OVRFLO repo). Do not implement lending burn or factory forwarders here.

## This ticket owns / does not own

**Owns:** SC1 Precompiles deletion; SC4 LICENSE.md scope note if still missing; ERC721Enumerable inheritance and both transfer-hook `super` calls; `tokensOfOwnerIn`; mint gate on all four `create*`; `factory` immutable; `IOVRFLOFactoryRegistry.sol`; standalone tests for enumeration + mint gate + size gate of `SablierV2LockupLinear`; README deviations table rows for R2/R2b/SC1; `forge inspect SablierV2LockupLinear storage-layout` committed to the fork README (SC5); NatSpec that `totalSupply()` is live-NFT count, not `nextStreamId - 1` (SC6).

**Does not own:** descriptor (03); ERC721 name/symbol (03); deploy script (04); artifacts in this OVRFLO repo (05); `setOvrfloStream` (05).

## Do not

- Rename `SablierV2LockupLinear` or any upstream identifier
- Change `ERC721(...)` constructor string literals
- Add `setMinter` or a minter slot
- Import OVRFLO sources into the fork
- Override `_beforeConsecutiveTokenTransfer` (SC7: it does not exist on OZ 4.9 ERC721)
- Forward `batchSize` as literal `1` (that deletes Enumerable's batch guard)
- Put new tests on upstream Base/Defaults
- Advertise `IERC4906`
- Deploy LockupDynamic
- Compile this work inside the OVRFLO repo
- Edit the plan file

## Implementation (binding)

1. First commit: delete `test/utils/Precompiles.sol` and its test (SC1). This removes five of six known-red `test-optimized` tests so real Enumerable regressions are readable.
2. If `LICENSE.md` is still bare GPL text, add the SC4 scope note at its head: GPL covers `src/`, `script/`, `vendor/`, and GPL-headered test utilities; remaining `test/` files are upstream's under their own headers and are not conveyed.
3. Add `src/interfaces/IOVRFLOFactoryRegistry.sol` with only `ovrfloInfo(address)` returning `(address treasury, address underlying, address ovrfloToken)`.
4. On the lockup abstract: inherit `ERC721Enumerable`. Change `_beforeTokenTransfer` to `override(ERC721, ERC721Enumerable)`, drop `view`, name the `batchSize` parameter, forward it verbatim, call `super._beforeTokenTransfer(...)` **before** the transferability check. Keep `_afterTokenTransfer` metadata-update behavior with its `super` call. Update `tokenURI`'s `override(IERC721Metadata, ERC721)` list as the plan's Files line states.
5. Add `tokensOfOwnerIn(owner, start, stop)`: bounds-clamped loop over `tokenOfOwnerByIndex`. Salvage name, `[start, stop)` range, `start < stop` required, and clamping from ERC721AQueryable (MIT). Page the owner's enumeration indices, not token ids.
6. Set `address public immutable factory` from the same constructor arg as `initialAdmin`.
7. At the start of Linear `createWithDurations` / `createWithRange` and LockupDynamic's two `create*`, call `ovrfloInfo(msg.sender)` and revert when `treasury == address(0)`.
8. Adapt inherited create tests per R2c (mock registry), do not delete them.
9. Write standalone tests for the scenarios below. Do not import UNLICENSED bases.
10. Size-gate `SablierV2LockupLinear` runtime and initcode (EIP-170 / EIP-3860) under the profile that deploys it. `forge inspect` uses that Solidity name.
11. Commit storage layout (`forge inspect SablierV2LockupLinear storage-layout`) to the fork README (SC5). Slot-addressed fixtures against canonical Sablier are invalid after this change.
12. NatSpec: `totalSupply()` is live-NFT count, not stream count (SC6).
13. Update README "Deviations from upstream v1.1.2" so every file `git diff --stat v1.1.2 -- src/` reports has a named cause (R2, R2b, license, SC1). Covers AE5 progress; 03 and 04 finish the table.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code).

1. Post the record in this chat **before the first code write**.
2. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
3. Fill **Final diff** before `Status: resolved`.

## Deviations from the plan

1. `_beforeTokenTransfer` is `override(ERC721Enumerable)`, not `override(ERC721, ERC721Enumerable)`. Solidity 0.8.23 rejects `ERC721` in that list unless `ERC721` is a direct base. Listing both as direct bases then requires a `supportsInterface` override. `super._beforeTokenTransfer(...)` still runs Enumerable, then ERC721.
2. R2c etches `MockOvrfloFactoryRegistry` runtime onto `users.admin` instead of deploying a new mock as `factory` / `initialAdmin`. A `new` mock would bump the test-contract nonce and move the hardcoded lockup addresses that `tokenURI` golden tests pin.
3. `forge fmt` is not applied to Linear/Dynamic, or to the `withdraw` hook and `SetNFTDescriptor` emit in the abstract. Current foundry fmt would rewrap those call sites. The withdraw access-control body stays byte-for-byte with `fork/bring-up`.

## Final diff

- Predicted blast radius (session intent record, before the first code write):
  - delete `test/utils/Precompiles.sol` and `test/utils/Precompiles.t.sol`
  - `src/interfaces/IOVRFLOFactoryRegistry.sol` (new)
  - `src/abstracts/SablierV2Lockup.sol` (Enumerable, `factory`, `tokensOfOwnerIn`, transfer hooks, `totalSupply` NatSpec, mint-gate helper)
  - `src/SablierV2LockupLinear.sol` and `src/SablierV2LockupDynamic.sol` (`create*` gates only)
  - `src/libraries/Errors.sol`
  - `test/Base.t.sol` (R2c)
  - `test/mocks/MockOvrfloFactoryRegistry.sol`
  - standalone `test/enumerable/` tests
  - fork README deviations table and storage layout
  - callers: inherited create tests through `users.admin`; later tickets own deploy and lending
- Actual (`git diff --stat fork/bring-up`):

```
 CHANGES.md                                |  17 +-
 README.md                                 |  72 ++++++-
 src/SablierV2LockupDynamic.sol            |   4 +
 src/SablierV2LockupLinear.sol             |   4 +
 src/abstracts/SablierV2Lockup.sol         |  73 ++++++-
 src/interfaces/IOVRFLOFactoryRegistry.sol |  13 ++
 src/libraries/Errors.sol                  |   6 +
 test/Base.t.sol                           |   5 +
 test/enumerable/DeploySize.t.sol          |  20 ++
 test/enumerable/EnumerableMintGate.t.sol  | 342 ++++++++++++++++++++++++++++++
 test/mocks/MockOvrfloFactoryRegistry.sol  |  17 ++
 test/utils/Precompiles.sol                | 178 ----------------
 test/utils/Precompiles.t.sol              | 104 ---------
 13 files changed, 548 insertions(+), 307 deletions(-)
```

- Misses: none of the predicted paths are absent. Extra: `CHANGES.md` dated U2 notice (GPL-3.0 §5(a)). Ticket owns list named README; the dated file still needs the modification date.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] `test/utils/Precompiles.sol` and its test are gone; no BUSL-1.1 header remains in the fork working tree except what 03 may still delete (descriptor is not this ticket)
- [x] `LICENSE.md` has the SC4 scope note if it was still missing
- [x] Mint two streams → `balanceOf` 2 and `tokenOfOwnerByIndex` returns both ids
- [x] Pledge-shaped `transferFrom` moves the id between owners' enumerations atomically
- [x] Burned depleted stream leaves both owners' enumerations; afterwards `tokenURI`/`ownerOf` revert while `getStream` still succeeds
- [x] `withdrawMaxAndTransfer` mutates enumeration correctly, including the contract-recipient hook case
- [x] `supportsInterface`: ERC721, ERC721Metadata, ERC721Enumerable are true; IERC4906 is not advertised (OQ5)
- [x] After a burn, `totalSupply()` diverges from `nextStreamId - 1`
- [x] Caller whose mock `ovrfloInfo` treasury is zero reverts on every `create*`; non-zero treasury mints (Covers AE9)
- [x] No `setMinter` selector exists
- [x] `symbol()` still returns the upstream value (identity change is U3)
- [x] Non-transferable stream still reverts transfer (hook check preserved)
- [x] `tokensOfOwnerIn` returns exact pages, clamps out-of-range windows, reverts on `start >= stop`, returns empty for a zero-balance owner
- [x] Inherited withdraw ACL tests still green (Covers AE4)
- [x] Inherited suite matches the U1 baseline except the Precompiles deletions and R2c adaptations; `FOUNDRY_PROFILE=test-optimized forge test` is a second gate
- [x] `SablierV2LockupLinear` runtime and initcode pass the size gate; `forge inspect` uses that name
- [x] Deviations table accounts for every `git diff --stat v1.1.2 -- src/` file this unit changes
- [x] New tests do not import UNLICENSED upstream Base/Defaults (R7b)

## Plan unit

U2 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
