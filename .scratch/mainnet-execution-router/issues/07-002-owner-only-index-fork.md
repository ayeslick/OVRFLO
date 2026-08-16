# 07 — `002` owner-only stream index in the fork

**What to build:** In the fork lockup, remove `ERC721Enumerable` and replace it with an owner-only
index: two mappings (`_ownedTokens`, `_ownedTokensIndex`) maintained in `_beforeTokenTransfer`,
plus `streamsOfOwner(owner)` and `streamsOfOwnerIn(owner, start, stop)`. Marketplaces see vanilla
ERC721 (deliberate — one line in the fork README deviation table). Plan:
`docs/plans/2026-08-15-002-feat-owner-only-stream-enumeration-plan.md` — read it whole; its
`### Sweep Contracts` is binding.

**Repo:** `/Users/jay/OVRFLO-Streams-u4`, branch `feat/u4-owner-only-index` (from campaign HEAD
`0f501abf`, contains `57e5cf2b`). OVRFLO repo is read-only for this ticket except this file.

**Blocked by:** — (orchestrator verified the plan's sweep section exists before dispatch)

**Status:** resolved — review approve-with-fixes; fixes landed at 0f77e638 (protected blocks byte-identical to 0f501abf); suite 610/11 known; not pushed | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.6-xhigh`

## Session prompt

```text
Implement docs/plans/2026-08-15-002-feat-owner-only-stream-enumeration-plan.md (OVRFLO repo path:
/Users/jay/OVRFLO/docs/plans/...) in the FORK repo /Users/jay/OVRFLO-Streams-u4.
Ticket: /Users/jay/OVRFLO/.scratch/mainnet-execution-router/issues/07-002-owner-only-index-fork.md
Spec: /Users/jay/OVRFLO/.scratch/mainnet-execution-router/spec.md — per-session rules apply.

Before first write: echo repo, branch, HEAD; confirm HEAD contains 57e5cf2b; run the fork suite
and reproduce the expected baseline 605 passed / 11 known failures. Expected-unverified: if it
does not reproduce, STOP and report the actual totals — do not proceed, do not invent a baseline.

Binding decisions (do not reopen):
- Mappings declared INLINE in src/abstracts/SablierV2Lockup.sol immediately before nextStreamId
  (the plan's Key Decision supersedes its older sweep bullet about an abstract contract).
- Index maintained in _beforeTokenTransfer; helpers take balanceBefore as a parameter (the OZ
  helpers read balanceOf at the wrong time otherwise — plan documents the timing hazard).
- ERC721Enumerable inheritance, tokenOfOwnerByIndex, totalSupply, tokenByIndex are REMOVED.
  supportsInterface must NOT advertise ERC721Enumerable afterward.
- Carry OpenZeppelin's MIT notice as a full third-party notice (version + source), not only a
  source comment (GPL file, MIT-derived code).
- Storage layout: run forge inspect before and after; the plan documents the expected slot shift.
  Commit the new layout to the fork README. NFT_DESCRIPTOR_SLOT consumers are re-derived, never
  hand-adjusted; add the deploy-time descriptor-slot assertion (write descriptor, assert neighbor
  slots unchanged).
- Invariant fuzzing of the index (008 queue item, promoted): random mint/transfer/burn sequences
  assert set-equality between the index and ground-truth Transfer-event bookkeeping, plus the
  swap-and-pop edge cases (last element, single element, self-transfer).
- Do not rename upstream identifiers. Do not touch withdraw/transfer ACL semantics.
- Size-gate the lockup (EIP-170 runtime, EIP-3860 initcode) under the profile that deploys it;
  fork solc stays pinned 0.8.23.

Intent record before first write. Unpinned decision → stop with a blocker. Do not edit the plan.
Do not push. Return: status, files, verification commands with pasted totals (both baselines and
final), deviations, git diff --stat.
```

## Owns / does not own

**Owns:** the two mappings + hook maintenance, both read functions, Enumerable removal,
supportsInterface change, MIT notice, storage-layout re-derivation + README, slot assertion,
invariant fuzz suite, deviation-table rows.
**Does not own:** artifact vendoring into OVRFLO (ticket 10), descriptor content, deploy script
changes beyond what the slot assertion needs, anything in `/Users/jay/OVRFLO`.

## Do not

- Keep any Enumerable surface "for compatibility"
- Declare the mappings in a new abstract contract (superseded decision)
- Read `balanceOf` inside the helpers instead of threading `balanceBefore`
- Touch withdraw ACL, `create*` gates, or the descriptor
- Compile or test the fork inside the OVRFLO repo

## Acceptance criteria

- [x] Baseline reproduced (605/11) and pasted before first write; intent record posted
- [x] Mint/transfer/burn maintain both mappings; swap-and-pop edge cases unit-tested
- [x] Invariant fuzz campaign green (index ≡ event-derived ground truth) — **smoke profile only**
- [x] Windowed owner page clamps, reverts `start >= stop`, empty for zero balance (`tokensOfOwnerIn`)
- [x] `supportsInterface(ERC721Enumerable)` is false; ERC721 + Metadata still true
- [x] Storage layout committed; descriptor-slot assertion in deploy path
- [x] Size gate green; suite green modulo the known-failure set; totals pasted
- [x] MIT third-party notice present; deviation table updated
- [x] Deviations recorded; Final diff filled

## Deviations from the plan

1. **Read names.** Ticket prompt used lens names `streamsOfOwner` / `streamsOfOwnerIn`. The lockup
   keeps `tokensOfOwnerIn` (same clamp / `start >= stop` / empty-balance contract). Plan 002 says
   that signature and nothing else. Router 008 says `002` does not change `tokensOfOwnerIn`.
   `streamsOfOwner` lives on the lens (plan 005 / ticket 09).
2. **`.gas-snapshot`.** Plan asked for a second commit. `forge snapshot` ran the suite and did not
   rewrite `.gas-snapshot` (mtime stayed 2026-08-14). No empty commit.
3. **Commit trailer.** Plain `git commit` appended `Co-authored-by: Cursor`. Replaced via
   `commit-tree` / `update-ref`. Later review-fix commit `0f77e638` also used plumbing.
4. **`CREATE_GAS_CEILING`.** Only planned edit to `OwnerIndexInvariants.t.sol`. Trace of the second
   `createWithRange` is 161,122 gas. Ceiling is 165,000.
5. **Invariant gate is smoke.** Fork default `[profile.default.invariant]` is 20 runs / depth 20.
   Mid-flight directive: do not run a deep profile. A 100/40 run passed before that directive; it
   is not the gate.
6. **Optimized descriptor size.** Re-measured under `FOUNDRY_PROFILE=optimized forge build --sizes`:
   18,420 runtime (README had 18,716). Descriptor source is unchanged. Table uses the new figure.
7. **Review fix (2026-08-15).** Restored the withdraw callback and `SetNFTDescriptor` emit to the
   `0f501abf` text. `forge fmt` had rewritten those blocks. Semantics were unchanged. Commit
   `0f77e638`. Smoke suite after restore: 610 passed / 11 failed.

## Final diff

Branch `feat/u4-owner-only-index` @ `0f77e638e7c7a9251463f35099bc8af5651bdb7e`
(contains `57e5cf2b`; review-fix on `842626bb`).

```
 CHANGES.md                                  |  17 ++
 LICENSE.md                                  |  41 ++++
 README.md                                   |  38 ++--
 script/DeployCore.s.sol                     |  19 +-
 script/DeployDeterministicCore.s.sol        |  35 +++-
 src/abstracts/SablierV2Lockup.sol           | 125 +++++++++---
 test/deploy/DeployOrder.t.sol               |  40 +++-
 test/enumerable/EnumerableMintGate.t.sol    |  49 +++--
 test/enumerable/OwnerIndexInvariants.t.sol  |  14 +-
 test/enumerable/OwnerIndexSetEquality.t.sol | 286 ++++++++++++++++++++++++++++
 10 files changed, 590 insertions(+), 74 deletions(-)
```

Commits: `842626bb` feat(lockup): Replace Enumerable with owner index;
`0f77e638` fix(lockup): Restore withdraw and descriptor form

## Plan unit

`002`, wave 1A. Gates ticket 10.
