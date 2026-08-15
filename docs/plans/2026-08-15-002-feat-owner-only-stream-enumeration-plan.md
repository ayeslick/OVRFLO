# Owner-only stream enumeration

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
**Checkout: `/Users/jay/OVRFLO-Streams-u4`, branch `feat/u4-fork-deploy`, HEAD `57e5cf2b`.** Commit the
work on that branch. This matters: the repository's main worktree `/Users/jay/OVRFLO-Streams` is on
`fork/bring-up` at `d3222714`, which does **not** contain `57e5cf2b` — no `test/enumerable/`, no
`ERC721Enumerable` in `src/`, no `tokensOfOwnerIn`. `web/scripts/check-ovrflo-stream-bytecode.mjs`
resolves the fork to `../OVRFLO-Streams` unless `OVRFLO_STREAMS_PATH` is set, so the documented
default path is the checkout without the work. An agent that opens it will find every anchor in this
plan absent. If the checkout you have does not contain `57e5cf2b`, stop and report.
Companion: `2026-08-15-003-feat-snapshot-pinned-enumeration-plan.md` covers the frontend. The two ship independently.

## Problem

`SablierV2LockupLinear` inherits OpenZeppelin `ERC721Enumerable`, which maintains two independent
indexes. OVRFLO reads one of them.

- **Owner enumeration** — `_ownedTokens`, `_ownedTokensIndex`. Serves `tokenOfOwnerByIndex`, which
  serves `tokensOfOwnerIn`, which is how the wall discovers a wallet's streams. Required.
- **Global enumeration** — `_allTokens`, `_allTokensIndex`. Serves `totalSupply` and `tokenByIndex`.
  **No `src/` contract and no frontend code calls either.**

Measured 2026-08-15 by disabling each write in a scratch copy of the extension and re-running
`test_Create_MintTwo_EnumeratesBothIds`:

| Enumeration writes at mint | Gas |
|---|---|
| Global half | 45,531 |
| Owner half | ~45,500 |
| Both (today) | ~91,000 |

Every OVRFLO deposit creates one stream and therefore pays 45,531 gas to maintain an index nothing
queries. Runtime bytecode carries 275 bytes for the same.

## Product contract

- A wallet's currently held streams stay discoverable from chain state alone. No indexer, no log
  scanning (streams-plan R12).
- `tokensOfOwnerIn(owner, start, stop)` keeps its current signature, owner-index semantics, clamp to
  `balanceOf(owner)`, and revert on `start >= stop`. The frontend needs no change to keep working.
- `balanceOf` and `ownerOf` stay canonical and untouched.
- `getStream`'s external ABI tuple is unchanged.
- Insertion and removal stay O(1). No scans, no tombstones, no storage arrays.

## The target state

`OVRFLOStream` becomes **vanilla ERC-721** — the OpenZeppelin 4.9.2 `ERC721` the tree already had
before the Enumerable swap — plus two OVRFLO mappings and one view. `ERC721Enumerable` is not
trimmed or subclassed. It is removed.

```
ERC721 (unmodified)
    _owners           tokenId → owner        canonical ownership
    _balances         owner   → count        canonical count

OVRFLO owner index (additions)
    _ownedTokens      owner + index → tokenId    discovery
    _ownedTokenIndex  tokenId → index            O(1) removal

External enumeration surface
    tokensOfOwnerIn(owner, start, stop)          and nothing else
```

Removed entirely: `ERC721Enumerable`, `IERC721Enumerable`, `_allTokens`, `_allTokensIndex`,
`totalSupply`, `tokenByIndex`, `tokenOfOwnerByIndex`.

The reverse index is not a competing source of ownership truth. It is an index over ownership
truth, maintained atomically with it. `ownerOf` stays the authority.

## The regression this change can ship silently

**Declaring the two mappings is the easy half. The code that writes them is the change.**

Today that write path is not in this repository. It lives in OZ 4.9.2's
`ERC721Enumerable._beforeTokenTransfer`, which dispatches to `_addTokenToOwnerEnumeration` and
`_removeTokenFromOwnerEnumeration`. Both helpers are `private`. Deleting the base class deletes the
maintenance along with the storage.

An implementer who declares `_ownedTokens` and `_ownedTokenIndex` and stops there produces a
contract that **compiles, deploys, mints, transfers, and burns without a single revert** — and
returns an empty array from `tokensOfOwnerIn` forever. `balanceOf` still reports the right count, so
the frontend sees "this wallet holds 7 streams" next to a wall with no rows. Every wallet's wall goes
blank and nothing anywhere throws.

So this change **adds** code; it does not only relocate it. Three parts, all required:

1. Declare `_ownedTokens` and `_ownedTokenIndex`.
2. Write the two index updaters. Keep the algorithm identical to OZ 4.9.2's
   `_addTokenToOwnerEnumeration` and `_removeTokenFromOwnerEnumeration` — the
   `if (tokenIndex != lastTokenIndex)` guard and both `delete`s are each load-bearing — but **take
   the pre-change balance as a parameter** rather than reading `balanceOf` inside. See "The timing
   contract" below for why.
3. **Call them from `_beforeTokenTransfer`**, preserving OZ's exact four-branch dispatch:

   ```
   from == address(0)      → mint:     no owner-removal
   else if (from != to)    → transfer: _removeTokenFromOwnerEnumeration(from, tokenId)
   to == address(0)        → burn:     no owner-add
   else if (to != from)    → transfer: _addTokenToOwnerEnumeration(to, tokenId)
   ```

   The `from != to` and `to != from` guards are the **self-transfer** case. Writing the naive
   two-branch version corrupts the index when an owner transfers a stream to themselves.

Every path that changes ownership in this fork reaches that one hook, so there is exactly one place
to get right and no others to find:

| Path | Reaches the hook via | Anchor |
|---|---|---|
| create | `_mint` | `SablierV2LockupLinear._createWithRange` |
| burn | `_burn` | `src/abstracts/SablierV2Lockup.sol` `burn()` — "Effects: burn the NFT" |
| transfer | `_transfer` | ERC721 `transferFrom` / `safeTransferFrom` |
| withdraw-then-transfer | `_transfer` | `src/abstracts/SablierV2Lockup.sol` `withdrawMaxAndTransfer()` — "Checks and Effects: transfer the NFT" |

**Escalation trigger.** If any ownership-changing path is found that does not route through
`_beforeTokenTransfer`, stop and report. Do not add a second maintenance site.

### The timing contract

OZ's two helpers read the owner's balance and depend on reading it **before ERC-721 updates it**.
`_addTokenToOwnerEnumeration` uses `balanceOf(to)` as the new token's index; that is only the right
index while the balance has not yet incremented. `_removeTokenFromOwnerEnumeration` uses
`balanceOf(from) - 1` as the last index; that is only right while the balance has not yet
decremented.

Verified in `node_modules/@openzeppelin/contracts/token/ERC721/ERC721.sol` at 4.9.2: `_mint`,
`_transfer`, and `_burn` each call `_beforeTokenTransfer` first and mutate `_balances` afterward.

Nothing in either helper body states this. No assert, no parameter, no comment. The correctness
lives entirely in the call site, which is why copying the functions verbatim preserves a hazard
rather than removing one. Both failure modes are silent:

| Mistake | Result |
|---|---|
| Add runs after the balance increments | the owner's first token lands at index 1, index 0 is never written, and the last token is unreachable through `tokensOfOwnerIn` |
| Remove runs after the balance decrements | `lastTokenIndex` is one too low, the swap moves the wrong token, and one id is orphaned |

**Put the balance in the signature** so a wrong call site is visible where it is written rather than
two frames down:

```solidity
/// @param balanceBefore `balanceOf(to)` as of before ERC721 applies this transfer.
function _addToOwnerIndex(address to, uint256 balanceBefore, uint256 tokenId) private;

/// @param balanceBefore `balanceOf(from)` as of before ERC721 applies this transfer.
function _removeFromOwnerIndex(address from, uint256 balanceBefore, uint256 tokenId) private;
```

Keep the bodies line-comparable to OZ's so the swap-and-pop can still be checked against the
original. Change the interface, not the algorithm.

`test/enumerable/OwnerIndexInvariants.t.sol` is what catches a dropped write path: four of its six
cases assert on `tokensOfOwnerIn` contents and fail against an inert index. Those tests are green
today, so they must be green after — a passing suite is the evidence that the maintenance survived.

## Approach

Add the two mappings and the owner-side algorithm to the fork, taken from OpenZeppelin's owner half.

### Vendor from OpenZeppelin 4.9.2, not 5.x

`package.json` pins `@openzeppelin/contracts` 4.9.2. OZ 5.x deleted `_beforeTokenTransfer` and
`_afterTokenTransfer` in favor of a single `_update`. The fork's transferability check is a
`_beforeTokenTransfer` override (`src/abstracts/SablierV2Lockup.sol:423-447` at `98a198d6`). A copy
taken from 5.x does not compile here, and the hook silently never fires if the mismatch is missed.

Vendor the owner half of `node_modules/@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol`
at 4.9.2. Keep the algorithm byte-comparable to the original so a future OZ advisory triages cleanly:
`_addTokenToOwnerEnumeration` and `_removeTokenFromOwnerEnumeration` keep their names, their
swap-and-pop shape, and OZ's convention that index `0` is a real index disambiguated by token
existence. Do not adopt the `ownedIndexPlusOne` offset used by `test/fizz/mocks/MockSablier.sol:230`
in the OVRFLO repo.

### Rejected: packing the index into `Stream`

`LockupLinear.Stream` slot 1 holds `asset`(20) + `endTime`(5) + three bools(3) = 28 of 32 bytes.
A `uint32 ownerIndex` fits the padding and would cost ~100 gas instead of ~22,100, because
`_createWithRange` already writes that slot before `_mint` runs.

**Declined.** `getStream` returns `LockupLinear.Stream memory` directly from storage, so adding the
field puts it in the returned ABI tuple. Preserving the tuple requires two struct types — one for
storage, one for the return value — kept in sync by hand. Two parallel definitions in a fork whose
review story is `git diff --stat v1.1.2 -- src/` is a worse trade than 22,100 gas. Recorded so it is
not rediscovered and re-litigated.

### Rejected: a Solidity page cap on `tokensOfOwnerIn`

A `MAX_OWNER_PAGE` constant that reverts on oversized ranges was considered and declined.
`tokensOfOwnerIn` is a `view`: an oversized call costs the protocol nothing, harms only the caller,
and is already bounded by the caller's RPC gas cap with a recoverable error. A revert converts that
into a permanent impossibility, fixed at deploy time from a 2026 performance budget. Page size is
frontend policy and lives at `web/lib/lending-math.ts:9` (`MAX_ENUMERATION_IDS`), where it can change.

## Where the code lives — decided, not left open

**Key Decision.** Write the mappings and both helpers **inline in `src/abstracts/SablierV2Lockup.sol`**.
No new file. Declare the two mappings **immediately before `nextStreamId`**, ahead of every other
variable `SablierV2Lockup` declares.

Two competing structures were built and measured during the sweep. They compile, both pass the
guard suite, and they differ in storage layout and in bytecode:

| Structure | `_ownedTokens` | `nextStreamId` | `_nftDescriptor` | Runtime |
|---|---|---|---|---|
| pristine (today) | 9, 10 | 13 | 14 | 21,713 |
| separate base contract | 9, 10 | 11 | 12 | 20,903 |
| inline, declared after `_nftDescriptor` | 11, 12 | 9 | **10** | 20,702 |
| **inline, declared before `nextStreamId`** | **9, 10** | **11** | **12** | ~20,702 |

Base-contract variables are laid out before the deriving contract's own, and within a contract in
declaration order. ERC721 occupies slots 5–8, so the first variable `SablierV2Lockup` declares takes
slot 9. Declaring the two mappings first therefore reproduces exactly the slots `ERC721Enumerable`
vacated, which is why `_nftDescriptor` lands at 12.

The chosen structure is the smallest and keeps both mappings and both helpers `private`.

**It does not avoid the licensing question — it is where the question arises.** The code being
copied is OpenZeppelin's, headed `MIT`
(`node_modules/@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol:1`).
`src/abstracts/SablierV2Lockup.sol:1` is headed `GPL-3.0-or-later`, so inline placement puts an MIT
body inside a GPL-headered file. GPL-3.0 can carry MIT code, and the fork already depends on
OpenZeppelin, so nothing here is blocked. What is required is attribution: the fork carries no
OpenZeppelin notice in `LICENSE.md`, `CHANGES.md`, or `README.md` today.

**Write a header comment above the vendored block** naming the OpenZeppelin 4.9.2 source path, its
MIT licence, and the fact that only the owner half is carried over. Record the same in the
`CHANGES.md` entry. A separate file would have made this an SPDX line instead of a comment; it does
not make the obligation go away.

Three consequences follow from choosing inline, and each contradicts what a separate base would give:

- `super._beforeTokenTransfer` resolves to `ERC721`, whose body is empty.
- The owner-index update is therefore **invoked explicitly** in the override body. It is not
  inherited.
- The mappings stay `private` and `tokensOfOwnerIn` reads `_ownedTokens[owner][i]` directly, in the
  same contract. No visibility widening, and no accessor to replace `tokenOfOwnerByIndex`.

**Derive `NFT_DESCRIPTOR_SLOT` from `forge inspect SablierV2LockupLinear storage-layout`, never from
the number in this plan.** If it is not 12, the mappings are declared in the wrong place — fix the
placement, not the constant.

`SablierV2LockupDynamic` inherits the same abstract, so it gets the index for free. It is not
deployed (README "Deploy") but must keep compiling for the inherited suite.

The `_beforeTokenTransfer` override at `src/abstracts/SablierV2Lockup.sol:424` currently declares
`override(ERC721Enumerable)` and delegates to `super` at line 433. With the base gone, the specifier
becomes a plain `override`, `super` resolves to `ERC721`, and the owner-index update must be invoked
explicitly in the override body rather than inherited.

`tokensOfOwnerIn` currently reads the index *through* `tokenOfOwnerByIndex`
(`src/abstracts/SablierV2Lockup.sol` `tokensOfOwnerIn` body). That function is being deleted, so the
loop must be rewired to read `_ownedTokens[owner][i]` directly. The external signature, the clamp to
`balanceOf(owner)`, and the `start >= stop` revert all stay exactly as they are.

## Blast radius (verified at fork HEAD `57e5cf2b`)

Verify against `57e5cf2b`, not `98a198d6`. The size figures below hold at HEAD; at `98a198d6` the
optimized profile did not compile and the descriptor was 233 bytes smaller.

- No `src/` contract reads `totalSupply` or `tokenByIndex`.
- No frontend code reads them. They appear in `web/lib/generated.ts` only because the ABI is
  generated from the contract, and regenerate away.
- None of the 155 inherited upstream tests touch them. v1.1.2 shipped no enumeration at all, so the
  inherited suite cannot break on this change.
- `supportsInterface` needs no code edit. It is inherited, and dropping the base stops it
  advertising `0x780e9d63` automatically.

Files that change, in the fork:

- `src/abstracts/SablierV2Lockup.sol`
- the owner-index source file
- `test/enumerable/EnumerableMintGate.t.sol`
- `test/enumerable/OwnerIndexInvariants.t.sol` — **currently untracked; commit it with this work.**
  If it is absent from the working tree, stop and report rather than re-deriving it.
- `script/DeployCore.s.sol` and `script/DeployDeterministicCore.s.sol` — both carry the slot constant
- `README.md` storage-layout table, size figures, and the deviation row (below)
- `CHANGES.md` — dated entry, GPL-3.0 §5(a)

### Storage layout moves — two scripts, not one

Removing `_allTokens` (slot 11) and `_allTokensIndex` (slot 12) shifts every later slot down by two:
`nextStreamId` 13→11, `_nftDescriptor` 14→12, `_streams` 15→13.

`NFT_DESCRIPTOR_SLOT = 14` appears **twice**: `script/DeployCore.s.sol:25` and
`script/DeployDeterministicCore.s.sol:26`. Each is read with `vm.load` to verify the descriptor
binding, because `_nftDescriptor` is private and has no getter. Both must become 12. Missing the
second one is not a compile error: slot 14 reads zero after the change, so
`DeployDeterministicCore` reverts `LockupDescriptorMismatch(0, descriptor)` at deploy time. No
workflow drives the deterministic scripts, so nothing catches it earlier.

The README's storage table must be regenerated from
`forge inspect SablierV2LockupLinear storage-layout`, and `README.md` currently names only
`DeployCore.s.sol` in the singular — correct it to name both.

### The deviation record is amended, not erased

`README.md`'s deviation table lists `ERC721Enumerable` and the `totalSupply` NatSpec as fork changes
tagged R2/R2b/SC6, and `CHANGES.md` carries a dated "ERC721Enumerable and mint gate" entry. Amend
the deviation row to record that global enumeration was added and then withdrawn, and mark the tags
superseded rather than deleting them. The GPL §5(a) record is append-only history; a reader must be
able to see both states.

## The OVRFLO repo is not untouched

The OVRFLO repo does not compile this tree, but it **embeds this tree's compiled output**, and the
plan's claim that removed ABI entries "regenerate away" is true only after that embedded copy moves.

- `artifacts/OVRFLOStream.json` holds the ABI and bytecode. `web/wagmi.config.ts:7` reads it as the
  **only** source of the lockup ABI for `web/lib/generated.ts`.
- `script/lib/OVRFLOTestFixtures.sol` and `script/seed-local.sh` deploy that bytecode. Every fork
  test and the local Anvil seed run the artifact, not the fork source.
- `artifacts/OVRFLOStream.provenance.md` stamps the source commit.

The drift is silent. `web/scripts/check-ovrflo-stream-bytecode.mjs` rebuilds the fork **at the
stamped commit**, so it keeps passing against a commit that no longer matches fork HEAD.

**The stamp is already stale before this plan starts.** Provenance names `98a198d6`; fork HEAD is
`57e5cf2b`, and the intervening commit changed `foundry.toml`'s misspelled `emv_version = "paris"`
to `evm_version = "shanghai"`. The provenance file's `EVM: paris` line is already contradicted by
the committed artifact's own metadata, which reads `evmVersion: shanghai`. Correct that line in the
same step, and do the re-stamp **first**, as its own commit — otherwise a build-config change and a
descriptor change ride along inside a diff meant to be enumeration-only.

**Step 1 of this work, not a follow-up:** re-stamp
`artifacts/OVRFLOStream.json` and `artifacts/OVRFLOStream.provenance.md`, then re-run
`wagmi generate`. Rebuild with the fork's **default** Foundry profile — a plain `forge build`, not
`shell/prepare-artifacts.sh`, which builds `FOUNDRY_PROFILE=optimized` and produces via-IR bytecode
that fails the gate.

`CONCEPTS.md` also asserts the Enumerable fact as shared vocabulary at lines 87, 265, and 275, and
line 265 names it as the *discovery* mechanism — the sentence a frontend agent reads before touching
`useStreams`. Correct all three in the same follow-up.

## Test accountability

### Already written and green (2026-08-15)

`test/enumerable/OwnerIndexInvariants.t.sol` exists and passes against the tree as it stands. Every
assertion uses only `tokensOfOwnerIn`, `balanceOf`, and `ownerOf` — the surface that survives — so
the file pins behavior *across* the change rather than describing one side of it. It must stay green
with no edits. Eight cases:

- `test_Create_IsDiscoverableImmediately` — the inert-index sentinel. Fails if the maintenance calls
  are declared but never wired, which is the one regression here that throws nothing.
- `test_SelfTransfer_LeavesIndexIntact` — the `from != to` / `to != from` guards. Fails against a
  naive two-branch port. Nothing else in the repository covers a self-transfer.
- `test_Remove_LastIndexedToken_SkipsSwapAndKeepsOrder` — the branch where removal skips the swap.
  Nothing else in the suite reached it.
- `test_Remove_MiddleToken_MovesLastIntoTheGap` — asserts the exact resulting order.
- `test_Remove_MovesTokenBackwardAcrossAPageBoundary` — the contract-level fact that plan `003`
  defends against: a token moves behind a boundary a reader has passed and is returned by no page,
  while `ownerOf` still names the original owner.
- `test_Burn_ThenMintAgain_ReusesTheFreedIndex` — `_streams[streamId]` survives burn, so a stale
  reverse-index entry must not resurface.
- `test_AdjacentPages_AtOneBlock_CoverTheSetExactlyOnce` — the property a pinned snapshot buys.
- `test_Create_StaysUnderGasCeiling` — ceiling 210,000, just above the measured 205,000–210,000 for
  a create to an owner who already holds a stream. Reintroducing the 45,531-gas global half turns
  this red. **Re-measure and lower it to roughly 165,000 as part of this change**, or the saving can
  be given back silently later.

### Existing tests that must change

`test/enumerable/EnumerableMintGate.t.sol` calls `tokenOfOwnerByIndex` at lines 59, 60, 71, 73, 107,
and 121. That function is deleted, so those six assertions must be rewritten against
`tokensOfOwnerIn`. The tests keep their names and their meaning; only the accessor changes.

- `test_TotalSupply_DivergesFromNextStreamIdAfterBurn` is deleted. It documents a property that
  exists only because the global half exists. Its removal is correct, not a coverage loss.
- `test_SupportsInterface_ReportsEnumerableNotIERC4906` (line 127) currently asserts
  `supportsInterface(type(IERC721Enumerable).interfaceId)` is **true**. It must assert false, and
  the `IERC721Enumerable` import goes with the base class.
- The `totalSupply()` assertions at lines 88, 134, 143, and 145 are deleted with the function.

### Sweep Contracts

Review-blocking. Recorded 2026-08-15 from the ignorance-lens sweep; every rule cites verified
evidence. Point-fixes are already applied above and are not repeated here.

- **Declare the two mappings as a separate abstract contract occupying `ERC721Enumerable`'s exact
  position in the inheritance list** (`src/abstracts/SablierV2Lockup.sol:24`, last base). That keeps
  them at slots 9–10 and yields `_nftDescriptor` 12. Declaring them inside `SablierV2Lockup`'s own
  storage section instead puts `_nftDescriptor` at **10**. Both are correct code and the plan's
  stated 12 is only true for the first. **Derive the constant from `forge inspect`, never copy it.** — *layout*
- `totalSupply` is **not** purely inherited. `src/abstracts/SablierV2Lockup.sol:120-125` re-exports it
  with its own NatSpec via `super.totalSupply()`. Delete the function and its comment. `tokenByIndex`,
  `tokenOfOwnerByIndex`, and `supportsInterface` have no `src/` mention and drop with the base. — *lockup*
- The `_afterTokenTransfer` override at `src/abstracts/SablierV2Lockup.sol:407-418` needs **no**
  change: `ERC721Enumerable` does not override it, so `super` already resolves to `ERC721`. Named so
  it is not "fixed" needlessly. — *lockup*
- `test/deploy/DeployOrder.t.sol` is an OVRFLO-authored test, not inherited, and **all four of its
  cases fail in `setUp`** after the shift — it loads slot 14 at `:66`. The "inherited suite cannot
  break" claim is true and does not cover this file. — *tests*
- Add a `test/deploy/DeployOrder.t.sol` case that runs `DeployDeterministicCore.deploy` with a fixed
  salt. Nothing references that script today, so its slot constant is the one copy no test covers. — *tests*
- `CREATE_GAS_CEILING` is the **one edit** `OwnerIndexInvariants.t.sol` takes; every assertion stays
  as written. Re-measure the second create and round up to the next 5,000, recording the figure in
  NatSpec. The ceiling must be low enough to catch the ~46,000-gas global half returning, not tight
  enough to trip on unrelated drift. — *tests*
- **Never re-measure that ceiling under `--gas-report`.** The gas inspector inflates the `gasleft()`
  window: 594,846 reported against a real 205,747, which reads as a failure that is not one. Take
  the figure from a `-vvvv` trace. — *tests*
- Keep the `IERC721Enumerable` import at `EnumerableMintGate.t.sol:7` and flip line 127 to
  `assertFalse`. The import is an interface file in `node_modules`, not the base class. This is the
  only assertion that the contract stopped advertising `0x780e9d63`; deleting it removes the sole
  guard against a future subclass re-advertising the interface without the writes. — *tests*
- Rewrite `README.md:113-115` prose as well as the slot table — every sentence in it becomes false —
  and re-measure **both** rows of the size table at `README.md:119-124`, default and via-IR. — *docs*
- Append a new dated `CHANGES.md` entry naming the superseded 2026-08-14 "ERC721Enumerable and mint
  gate" entry and recording the new slots. Do not edit the older entry; the GPL §5(a) record is
  append-only. — *docs*
- Field naming: this plan writes `_ownedTokenIndex`, OZ writes `_ownedTokensIndex`. Use OZ's spelling
  so the vendored code stays greppable against the original. — *lockup*
- The `ownedIndexPlusOne` warning points at the wrong line. The convention is declared at
  `test/fizz/mocks/MockSablier.sol:51` and implemented at `:244-257` in the OVRFLO repo, not `:230`
  (which is range validation). — *docs*
- Step 4 is the primary gas gate; the size figures in step 3 are measured separately and are not
  derived from it. The original 21,438 was a derived number and was wrong by 500–700 bytes. — *verification*
- **Regenerate `out-optimized/` before any `FOUNDRY_PROFILE=test-optimized` run.** That profile does
  not compile from source — `test/Base.t.sol:145-155` branches on `isTestOptimizedProfile()` and
  `test/utils/DeployOptimized.sol:44-50` deploys pre-built bytecode from `out-optimized/`, which is
  gitignored and already stale in the working tree. A green optimized suite would otherwise be
  produced entirely from the pre-change contract with `ERC721Enumerable` still in it. Run
  `./shell/prepare-artifacts.sh` first. — *verification*
- `.gas-snapshot` is tracked (413 lines, 192 mentioning `LockupLinear`) and every lockup entry moves
  by roughly 45,000 gas. No CI job gates it, so it goes stale silently. Regenerate it with
  `forge snapshot` in its own commit so the reviewable source diff stays legible. — *docs*
- Quote OZ's four-case dispatch into the implementation with **both `else if` guards intact**; only
  the two global-half branches are deleted. The naive two-branch rewrite corrupts a self-transfer:
  it removes at `balanceOf - 1` then re-adds at `balanceOf`, one past the end, leaving the token at
  an index no page reaches while `balanceOf` and `ownerOf` still read correctly. Reachable without a
  contract, via `transferFrom(owner, owner, id)` or `withdrawMaxAndTransfer(streamId, self)`
  (`src/abstracts/SablierV2Lockup.sol:368`). Verified: the naive build fails
  `test_SelfTransfer_LeavesIndexIntact`; the guarded build passes 8/8. — *lockup*

## Verification

1. `forge build` clean.
2. `forge test` with no RPC set — the pre-change tree is **605 passed, 11 failed**: ten
   `test/fork/**` `setUp()` failures from an unset `RPC_URL_MAINNET`, plus the recorded `MemoryOOG`
   exception in `LockupDynamic` (`README.md:217`). Re-run before touching anything and use that as
   the baseline. Any failure outside those eleven is this change.
3. `forge build --sizes`, **default profile** — `SablierV2LockupLinear` runtime lands near **20,700**,
   down from 21,713. Do not target 21,438: that figure came from disabling the write paths only, and
   removing the extension also deletes `tokenByIndex`, `totalSupply`, `tokenOfOwnerByIndex` and its
   revert string, the `supportsInterface` branch, and the array push/pop. Measured at 20,702 inline
   and 20,903 for a separate base. Regenerate the README table from the build rather than matching a
   number. `FOUNDRY_PROFILE=lite` moves these figures.
4. `test_Create_MintTwo_EnumeratesBothIds` at or near **395,033**, down from 485,823, default
   profile. Measured on a built variant, so this is the primary gas gate. Under
   `FOUNDRY_PROFILE=lite` the baseline is 508,958 instead.
5. `forge inspect SablierV2LockupLinear storage-layout` matches the regenerated README table, and
   `NFT_DESCRIPTOR_SLOT` matches `_nftDescriptor`'s new slot.

## Out of scope

- Any change to `getStream`, `ownerOf`, `balanceOf`, or the withdraw ACL.
- Packing `ownerIndex` into `Stream` (declined above).
- A Solidity page cap (declined above).
- The lens/periphery read contract. Separate decision, separate plan, no contract change.
- Frontend changes. See `2026-08-15-003`.
