# OVRFLO Stream Lens

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Repository: `OVRFLO` (main). This is OVRFLO periphery, not a stream-protocol contract, so it does not
go in the fork.
Unblocks: the complete-set consumers named in `2026-08-15-001`. Removes one Sweep Contract rule from
`2026-08-15-003`. The borrow quote moved to `2026-08-15-007` on 2026-08-15 — it is a core
`OVRFLOLending` change and has nothing to do with this contract.

## Problem

Two unrelated defects share one cause: reading a stream costs four calls.

`web/hooks/useStreams.ts:175-193` hydrates every id with `ownerOf`, `getStream`,
`withdrawableAmountOf`, and `statusOf`. The fork's `tokensOfOwnerIn` returns `uint256[] memory
tokenIds` — **ids only**. It solved the reverse lookup, not the fan-out.

**Defect one — the complete-set consumers.** `web/lib/claim-all.ts:79` builds its claim queue from
the streams array, and `web/components/borrow/BorrowFlow.tsx:760` decides the `"empty"` stage from
it. Both need every stream the wallet holds. Once `2026-08-15-001` pages the list, both act on a
window: CLAIM ALL claims the loaded pages and reports success while leaving the rest, and a wallet
whose only eligible stream sits on a later page is told it has none and cannot borrow.

**Defect two — hydration can silently miss the pin.** `2026-08-15-003` requires the hydration batch
to carry the same block identity as the id pages. That is a rule an implementer must remember, and
the test-accountability lens showed the failure is invisible: pinning the pages and leaving
hydration on `readQuery` still stamps a coherent-looking `{blockNumber, blockHash}` pair.

## Product contract

- One call returns an owner's streams, hydrated. No fan-out, no multicall chunking.
- A per-stream read that reverts degrades that one row, never the whole call. This must not regress
  from today's `allowFailure: true`.
- The lens holds no state, has no admin, and owns nothing. It ships deployless — bytecode in the
  frontend bundle, no on-chain address — so replacing it is a frontend release.
- It reads. It never writes, never holds tokens, and is never in a transaction path.
- The complete-set consumers get the complete set at one block, routed by the already-known
  `balanceOf`: below a mutable frontend threshold, one `streamsOfOwner` call; above it, go directly
  to merging `streamsOfOwnerIn` windows all pinned to one block — do not issue a call known to
  exceed the provider ceiling (roughly 2,000–2,500 streams — sized below) just to watch it fail.
  Either path yields the whole set; neither is a refusal threshold. (`008` owns this routing rule.)

## Prior art

**Aave's `UiPoolDataProviderV3`** is the canonical precedent and the shape to follow. Verified from
source: it is stateless apart from two immutables, carries no admin and no access control, returns a
single composite struct array rather than parallel arrays, and uses `try/catch` for non-critical
sub-reads while letting core failures revert. It takes **no pagination parameter** — it returns
every reserve in one call.

Aave gets away with no pagination because a user's position count is bounded by the number of
reserves, roughly thirty. **OVRFLO's set is unbounded and transferable**, which is the harder case,
so this lens takes an optional range where Aave does not. That is the one deliberate divergence.

Morpho solves the same problem with a GraphQL API. That is an indexer and is excluded by
streams-plan R12.

## Interface

```solidity
struct StreamView {
    uint256 streamId;
    address owner;
    address sender;
    IERC20 asset;
    uint40 startTime;
    uint40 cliffTime;
    uint40 endTime;
    uint128 deposited;
    uint128 withdrawn;
    uint128 refunded;
    uint128 withdrawable;
    uint8 status;          // Lockup.Status crosses the ABI as uint8
    bool isCancelable;
    bool ok;               // false when hydration reverted; every other field is then zero
}

/// Complete set. One call, no paging. Serves claim-all and borrow eligibility.
function streamsOfOwner(ILensSource lockup, address owner)
    external view returns (StreamView[] memory);

/// Windowed. Serves the wall's pager, and the degradation path for a wallet too large for one call.
function streamsOfOwnerIn(ILensSource lockup, address owner, uint256 start, uint256 stop)
    external view returns (StreamView[] memory);

/// Known ids, no enumeration. Serves claim-all retry over a known queue and single-row refresh
/// after a write. The only surface where an `ok: false` row is reachable today (burned/unknown id).
function streamsByIds(ILensSource lockup, uint256[] calldata ids)
    external view returns (StreamView[] memory);
```

**The struct is the full `LockupLinear.Stream` surface plus `owner`, `withdrawable`, `status`, and
`ok`.** Do not trim it. **The dropped booleans are encoded, not lost** (specified 2026-08-15, not
merely asserted): `isDepleted ⇔ status == DEPLETED` and `wasCanceled ⇔ status == CANCELED` in the
fork's `Lockup.Status` enum — `useStreams`'s `isDepleted` filter reads `status` after this plan, and
the frontend mapping is one comparison. `isStream` needs no field: an id that is not a stream fails
hydration and surfaces as `ok: false`. `isTransferable` stays dropped as unused.
`refunded`, `cliffTime`, `isCancelable`, and `isDepleted` are all read today
from the same `getStream` return the lens replaces — `useStreams.ts:326-328` computes
`remaining = deposited - withdrawn - refunded` and filters on `isDepleted`, `useStreams.ts:315-318`
passes `cliffTime` and `isCancelable` into the schedule, and `refunded` reaches `payoff.ts`,
`ledger-card.ts`, and `BorrowFlow.tsx`. A trimmed struct forces a second `getStream` per stream,
restoring the fan-out the lens exists to remove — and fixing it means a struct change and a
frontend release.

**Empty owner:** `streamsOfOwner` returns an empty array when `balanceOf` is zero, and otherwise
delegates. It cannot delegate unconditionally — `tokensOfOwnerIn` reverts
`SablierV2Lockup_InvalidQueryRange` when `start >= stop`, and a zero balance gives `(0, 0)`.
`streamsOfOwnerIn` propagates that revert unchanged so the windowed form's range semantics stay
identical to the lockup's, which is what plan `001`'s pager is written against.

### `ok` is defensive, not load-bearing — corrected

An earlier draft called this "the whole failure design". That was wrong, and the correction matters
because it changes what the test suite can prove.

**No read in the owner-scoped path can revert.** `tokensOfOwnerIn` sources ids from
`tokenOfOwnerByIndex`, so every id it returns is live at that block and `ownerOf` cannot revert. The
`notNull` guard is `isStream`, which `SablierV2LockupLinear` sets at create and **never clears** —
`burn` calls only `_burn` on the NFT (`OVRFLO-Streams-u4/src/abstracts/SablierV2Lockup.sol`, `burn`,
"Effects: burn the NFT"). So `getStream`, `statusOf`, and `withdrawableAmountOf` do not revert for
any minted id, burned or not. The burn race the earlier draft described cannot be staged either: a
burned id leaves the owner's enumeration in the same block, so the lens never sees it.

Keep `ok` anyway — it is one bool and it is the difference between a degraded row and a reverted
page if any future lockup change makes a read fallible. But state it as insurance, and do not write
a test that pretends to exercise it through a burn.

**Decided 2026-08-15: `streamsByIds(ILensSource, uint256[])` ships alongside.** With a
caller-supplied id array, a burned or unknown id genuinely reverts hydration (`ownerOf` on a burned
NFT), which makes `ok` live and its test writable — and it is what a claim-all retry over a known id
set wants, plus single-row refresh after a write. The cost is a loop over the same per-stream
hydration internals the owner forms already need, and shipping it later would mean a second
bundle/ABI regeneration for ten lines. An `ok: false` row keeps the all-zero rule: `owner` is
unreadable for a burned id, so the row carries no trustworthy field.

### try/catch — one call, one catch

"Wrap each per-stream read group" is not expressible: Solidity's `try` binds to exactly one external
call. Hydrate one stream inside a single external self-call and wrap that:

```solidity
try this.hydrateOne(lockup, streamId) returns (StreamView memory v) { ... }
catch { view.ok = false; }        // bare catch, see below
```

All-or-nothing per stream, so an `ok: false` row is entirely zero. That matches
`web/hooks/useStreams.ts:296-304`, which drops a row when **any** of its four reads fails. Four
sibling `try` blocks would produce partially-populated rows and invite a consumer to trust a field on
a failed row. The cost is one extra `CALL` per stream, which the gas budget below must account for.

**The catch clause must be bare `catch` or `catch (bytes memory)`.** The lockup reverts with custom
errors (`Errors.SablierV2Lockup_Null`), which `catch Error(string memory)` does **not** catch — that
variant would let one bad stream revert the whole call, the exact regression this design exists to
prevent.

## Deployless, not deployed

Decision reversed 2026-08-15 (user, execution-router review). Both work; the decision is about
machinery, and the machinery tally favors deployless.

A **deployless** call ships the lens bytecode in the frontend bundle and sends it as `eth_call` data
with no `to`. Verified end to end: a constructor-return probe returned correctly against both
the seeded local Anvil 1.5.1 fork and the configured mainnet provider, and viem supports it
first-class — `call({ code, data })` at
`web/node_modules/viem/_esm/actions/public/call.js:49-56`, with `code` typed at
`_types/actions/public/call.d.ts:34`. Reports that this fails on Anvil are stale.

**What deployless deletes.** Deploying would make the lens the **first main-repo contract to be
explorer-verified** — `foundry.toml` carries one `[etherscan]` entry (a Tenderly virtual testnet),
no mainnet key, and no main-repo verification recipe exists. It would also thread a new address
through the whole pipeline (`seed-local.sh` → `deployments/local.json` → `write-env.sh` →
`config.ts`), force every existing `.env.local` to be reseeded, and turn every lens change into a
redeploy plus a config migration. Deployless deletes all of it: no address, no deploy script, no
verification recipe, no version skew — the lens and the frontend that expects its ABI ship in the
same bundle, atomically, and work on any chain including a fresh Anvil with zero setup.

**What deployless costs.** The bundle carries the initcode (a few KB per page call as calldata),
the lens cannot join a multicall3 batch (so `balanceOf` and the page read are two pinned calls,
which `2026-08-15-003` requires to share a `blockHash` anyway), and the repo needs one new piece of
machinery: the compiled bytecode embedded into the web bundle plus a **drift gate** so the embedded
copy cannot go stale against `src/OVRFLOStreamLens.sol` — the exact apparatus
`artifacts/OVRFLOStream.json` and `check-ovrflo-stream-bytecode.mjs` already provide for the fork,
copied for a main-repo contract.

Recorded so it is not re-litigated: **deployed is the tested fallback, not a rejected idea — and
its shape is pre-specified** (enriched 2026-08-15 from the zFi review). The fallback is a
**deterministic CREATE2 deployment**: canonical compiler settings → creation bytecode → fixed salt
→ derived address emitted as a generated constant the frontend imports. No environment variable, no
factory registry entry, no deployment-artifact plumbing — the address is reproducible client
capability, not protocol truth (zFi's `SwapboardView` pattern, verified by its
`check-create2-artifacts` discipline). The drift gate and creation-bytecode generation this plan
already requires serve both modes unchanged. **The flip trigger is concrete:** if the `008`
capability probe finds deployless-plus-pin unsupported or unreliable on the target providers, flip
to deployed-CREATE2 without re-opening the debate; the switch is one deploy per network, a
`seed-local.sh` step, and the call site swapping `code` for the generated address.

## What this deletes

- **The refusal threshold.** `MAX_ENUMERATION_IDS` exists because
  `web/hooks/useStreams.ts:156` fetches every id and hydrates all of them, so the only alternative
  to a truncated list is to refuse. With `2026-08-15-001` paging the display and this lens serving
  the complete-set consumers, nothing reads unboundedly and the threshold has no job. Delete it from
  all three books.
- **One `2026-08-15-003` Sweep Contract rule.** "The hydration batch carries the same pin as the id
  pages" stops being a rule an implementer must remember. One call is one block by construction, so
  the split-pin bug becomes impossible rather than guarded.

## Sizing the unbounded call — corrected, and the conclusion moves

An earlier draft said "roughly 10k gas per stream, so 5,000 streams is about 50M". Both the number
and the **model** were wrong.

**The floor alone is the whole old budget.** `LockupLinear.Stream` occupies four storage slots and
`ownerOf` reads a fifth. Five cold SLOADs at 2,100 is **10,500 gas per stream** before a single
warm read, call frame, or arithmetic op. On top: roughly thirty warm SLOADs, four staticcall frames,
and three separate runs of `_calculateStreamedAmount` — `getStream`, `withdrawableAmountOf`, and
`statusOf` each recompute it. Realistic linear cost is **16k–20k per stream**.

**And cost is not linear.** Memory expands quadratically at `3w + w²/512`. A struct of this width is
roughly 13 words in memory plus a similar ABI-encode buffer, so 5,000 streams is about 125,000 words
— roughly 30M gas of memory on top of about 90M of call cost. Total near 120M, not 50M.

**So the real ceiling is about 2,000–2,500 streams**, not 5,000. Response size is a second unstated
ceiling: 2,000 structs is roughly 750 KB of ABI data and about 1.5 MB as hex in a JSON-RPC response.

**That moves the conclusion.** The windowed form is not a rare degradation path for a pathological
wallet — it is the **normal** path above a couple of thousand streams. The complete-set consumers
must therefore be written to page, not to assume one call suffices. Say so where they are built.

Still **do not add a Solidity bound** — the reasoning from `2026-08-15-002` holds: the cost lands on
the caller's RPC, the failure is recoverable, and an immutable constant chosen today cannot change.
Measure the real per-stream cost during the build and record it in the test's NatSpec, in the style
of `test/DeploySize.t.sol`'s `deliberate-ceiling` comments — **not** by editing this plan, which
`AGENTS.md` forbids while implementing.

## Files (when built)

- `src/OVRFLOStreamLens.sol` — new
- `test/OVRFLOStreamLens.t.sol` — new
- `web/wagmi.config.ts` / `web/lib/generated.ts` — the ABI (wagmi codegen emits no bytecode)
- `web/lib/generated/lens-bytecode.ts` — new: creation bytecode (`bytecode.object`) via a dedicated
  generation step
- `web/scripts/check-lens-bytecode.mjs` — new drift gate on creation bytecode, patterned on
  `check-ovrflo-stream-bytecode.mjs`'s fail-do-not-warn shape
- `web/hooks/useStreams.ts` — hydration becomes one deployless read
- `web/lib/claim-all.ts`, `web/components/borrow/BorrowFlow.tsx` — complete-set reads
- Maps, gated: `docs/maps/state/keys/chain-reads.md`, regenerated
  `docs/maps/state/functions/INDEX.md`

## Test accountability

- **A reverting stream degrades one row — tested through `streamsByIds`.** The owner-scoped forms
  cannot produce an `ok: false` row via a burn: ids and hydration happen in one atomic call at one
  block, and a burned id leaves the owner's enumeration in that same block (per the `ok` discussion
  above — "do not write a test that pretends to exercise it through a burn"). Assert a burned id and
  a never-minted id in the caller-supplied array each yield `ok: false` (all other fields zero) with
  correct data for their neighbours.
- **`streamsByIds` agrees with enumeration.** Feed it the exact id list `tokensOfOwnerIn` returns
  for an owner at one block and assert the rows equal `streamsOfOwner`'s. Guards the two hydration
  paths drifting apart.
- **`streamsOfOwner` equals the concatenation of its windows.** Assert the unbounded form returns the
  same set as paging `streamsOfOwnerIn` across the whole range at one block.
- **The lens agrees with direct reads.** For one stream, assert every `StreamView` field equals what
  `ownerOf` / `getStream` / `withdrawableAmountOf` / `statusOf` return directly. Guards a field
  mis-wired in the struct, which no other test would catch.
- **Empty owner returns an empty array**, not a revert.
- **Gas ceiling for one stream**, recorded, so the unbounded-call sizing above stays honest. Measure
  with plain `forge test`; see the `--gas-report` note in `2026-08-15-002`.

### Sweep Contracts

Review-blocking. Recorded 2026-08-15 from a three-lens sweep. Point-fixes are applied above and not
repeated. **The completeness critic has not run.**

**Interface and types**

- `ISablierV2Lockup` and `Lockup.Status` **do not exist in this repo**, and the fork's
  `ISablierV2Lockup` is insufficient anyway — it omits `getStream`, and `tokensOfOwnerIn` is declared
  on no interface at all, only on the abstract contract. Extend the hand-kept
  `interfaces/ISablierV2LockupLinear.sol` with `statusOf`, `balanceOf`, and `tokensOfOwnerIn`, plus a
  local `Status` enum mirroring the fork's ordering. **Do not add the fork as a dependency** — that
  would pull GPL source into an MIT repo and break the hand-kept-interface convention. — *interface*
- An enum crosses the ABI as `uint8`, so a local enum and a raw `uint8` field are byte-identical on
  the wire. Interchangeable; pick either. — *interface*

**Frontend**

- **`useStreams` keeps its own `balanceOf` read.** Ready-empty stays gated on `balance === 0n`
  (`useStreams.ts:236-239`), and a lens array shorter than `balanceOf` is `unavailable` with an
  `incomplete` failure. Without this, a lens returning empty for *any* reason — stale embedded
  bytecode, a mis-regenerated ABI — is indistinguishable from a wallet with no streams, and `watch-entry.ts:49`
  sends a holder to first-run. That is the defect plan `001` records as why the last attempt was
  abandoned. — *useStreams*
- Carry `useStreams.ts:374-381` forward unchanged: a book where **every** row is `ok: false` is
  `unavailable` with a `subcall` failure, never ready-empty. The plan specifies row behavior only. — *useStreams*
- **The ownership invariant survives consolidation.** Today `useStreams` verifies
  `ownerOf(id) == requested account` before accepting a row; the lens returning `owner` does not
  retire that check, it relocates it: an `ok` row whose `owner` differs from the requested owner is
  an invariant failure — the book is `unavailable` with an `incomplete` failure, never a rendered
  row. — *useStreams*
- **Eligibility stays in TypeScript.** `borrowRouteEligible` is computed at `useStreams.ts:95-119`
  from the factory registry, which the lens cannot see. Give `useStreams` a `mode` selecting
  `streamsOfOwner` or `streamsOfOwnerIn`; `BorrowFlow.tsx:96` passes complete-set mode. **The lens
  computes no eligibility** and does not read the registry. — *useStreams, BorrowFlow*
- **The lens takes `lockup` as a call argument, never a constructor immutable.** `invalidate.ts:59-65`
  matches stream reads by substring-searching the serialised query key for the lockup address, and
  wagmi keeps `args` in the key. Binding it as an immutable removes the address from the key and
  **post-write refresh silently stops working** — no error, just pre-transaction data until the next
  poll. If that ever changes, add the lens to `resourceContracts` and `marketContracts` in the same
  commit. — *lens, invalidate*
- **Delete the four-call hydration path; do not keep it as a fallback.** A path that runs only when
  the lens is missing is a second, untested implementation of the ready-empty and `ok` rules. The
  lens is deployless, so it cannot be "missing" at runtime — the drift gate is what keeps the
  embedded copy honest. — *useStreams*
- `STREAM_PAGE_SIZE = 25` is justified in its own comment by the four-reads-per-id arithmetic this
  plan removes. Re-derive it from measured per-stream lens gas against a conservative `eth_call` cap,
  and rewrite the rationale comment in the same commit. Plan `004` injects this constant into an E2E
  scenario, so it is not cosmetic. — *lending-math*
- `useLoanStreams` stays on its two-call batch and out of the lens; answer `003`'s snapshot question
  there separately. — *useLoanStreams*

**Deployless shipping — bytecode in the bundle, one gate**

*(This block replaced the deployed-path pipeline contracts when the decision reversed. The address
pipeline, `parseRequiredAddress`, and `FIELD_BINDINGS` items died with the address itself.)*

- **A dedicated bytecode generation step — wagmi codegen cannot do this** (corrected 2026-08-15).
  The wagmi Foundry plugin emits contract *configuration* (ABI, addresses, names), not bytecode. And
  viem's deployless mechanism counterfactually **deploys** the supplied contract before calling it,
  so what must be embedded is the **creation bytecode** (`bytecode.object` in the foundry artifact),
  not `deployedBytecode`. Pipeline: foundry artifact → `bytecode.object` →
  `web/lib/generated/lens-bytecode.ts` → drift gate. The ABI still comes through
  `web/wagmi.config.ts` as usual. — *ops*
- **The drift gate compares creation bytecode** (precedent for shape:
  `web/scripts/check-ovrflo-stream-bytecode.mjs`, which compares `deployedBytecode` — copy the
  fail-do-not-warn pattern, not the field). It rebuilds `src/OVRFLOStreamLens.sol` and compares
  `bytecode.object` against the embedded copy, so a lens edit that skips regeneration cannot ship a
  stale lens silently. This is the deployless analogue of the "wrong address ships silently"
  failure the deployed path guarded with `eth_getCode`. — *ops*
- No entry in `deployments/local.json`, no `NEXT_PUBLIC_*` variable, no `write-env.sh` line, no
  `seed-local.sh` step. E2E and local dev use the same deployless call as production; there is no
  lens bootstrap to fail. — *ops*
- `test/DeploySize.t.sol`'s `string[4]` deployables array **does not widen** — the lens is never
  deployed, so EIP-170 does not apply. The binding limit is EIP-3860 initcode size (49,152 bytes);
  assert it in the lens's own test with a `deliberate-ceiling` comment. — *tests*
- `NEXT_PUBLIC_ABI_VERSION` **stays at 1**. It tracks breaking changes to ABIs the frontend already
  consumes, not additions. Recorded so it is not re-litigated; a wrong bump breaks every environment
  at once. — *config*

**Tests**

- The field-agreement and window-concatenation tests run against the **real** `OVRFLOStream`
  deployed from `artifacts/OVRFLOStream.json` (`foundry.toml` already grants read access), not
  `MockSablier` — which has no `statusOf` and whose `getStream` never reverts, the opposite of the
  fork. Coding standard X4 requires external struct ABIs verified empirically; a mock does not
  satisfy it. — *tests*
- Name the successor Vitest scenarios for `web/tests/hooks/useStreams.enumerable.test.ts`. Its cases
  exercise the `balanceOf` → `tokensOfOwnerIn` → hydration staging that ceases to exist. — *tests*

## The borrow quote is a separate plan

`web/lib/lending-math.ts` mirrors `StreamPricing` in TypeScript, and that duplication has the same
shape as the hydration fan-out this plan fixes. It is **not** solved here.

`2026-08-15-007` solves it on `OVRFLOLending` itself (redesigned 2026-08-15): a direct
`previewBorrow` external function running the real fill path with writes gated off, made to fit by
flipping `via_ir = true` — the compiler sweep showed the old size constraint was self-imposed. No
new contract. Note for this plan: the via-IR flip changes **all** main-repo bytecode, so the lens's
embedded creation bytecode and its drift gate are generated under the shipping settings (via-IR),
which the provenance stamp records.

**This lens computes no borrow quote and gains no quote function of its own.** The quote lives on
`OVRFLOLending` (`previewBorrow`, from `007`); the lens's only role near the quote is
`streamsByIds` same-block hydration for `BorrowQuoteSnapshot` composition.

## Out of scope

- Any change to the lockup. The lens reads what exists.
- The pager (`001`), the pin (`003`), the contract index (`002`).
- A lens for the lending books. `lenderPositionAt` and `borrowerLoanAt` are append-only and their
  hydration is not a four-call fan-out; revisit only if measurement says otherwise.
- Writing through the lens. It is a view contract and stays one.
