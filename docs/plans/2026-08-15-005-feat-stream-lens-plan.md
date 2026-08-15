# OVRFLO Stream Lens

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Repository: `OVRFLO` (main). This is OVRFLO periphery, not a stream-protocol contract, so it does not
go in the fork.
Unblocks: the complete-set consumers named in `2026-08-15-001`. Removes one Sweep Contract rule from
`2026-08-15-003`.

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
- The lens holds no state, has no admin, and owns nothing. It can be redeployed or replaced at will.
- It reads. It never writes, never holds tokens, and is never in a transaction path.
- The complete-set consumers get the complete set in one call, with no paging loop and no budget.

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
```

**The struct is the full `LockupLinear.Stream` surface plus `owner`, `withdrawable`, `status`, and
`ok`.** Do not trim it. `refunded`, `cliffTime`, `isCancelable`, and `isDepleted` are all read today
from the same `getStream` return the lens replaces — `useStreams.ts:326-328` computes
`remaining = deposited - withdrawn - refunded` and filters on `isDepleted`, `useStreams.ts:315-318`
passes `cliffTime` and `isCancelable` into the schedule, and `refunded` reaches `payoff.ts`,
`ledger-card.ts`, and `BorrowFlow.tsx`. A trimmed struct forces a second `getStream` per stream,
restoring the fan-out the lens exists to remove — and fixing it means a redeploy and an address
rotation.

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

**Decide before building: does `streamsByIds(ILensSource, uint256[])` ship alongside?** With a
caller-supplied id array, a burned or unknown id genuinely reverts, which makes `ok` live and its
test writable — and it is what a claim-all retry over a known id set would want. It is either in
this plan or explicitly deferred; do not leave it to the implementer.

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

## Deployed, not deployless

Both work. The decision is about machinery, not capability.

A **deployless** call ships the lens bytecode in the frontend bundle and sends it as `eth_call` data
with no `to`. I verified this end to end: a constructor-return probe returned correctly against both
the seeded local Anvil 1.5.1 fork and the configured mainnet provider, and viem supports it
first-class — `call({ code, data })` at
`web/node_modules/viem/_esm/actions/public/call.js:49-56`, with `code` typed at
`_types/actions/public/call.d.ts:34`. Reports that this fails on Anvil are stale.

**Deploy it anyway.** The address pipeline already exists — `NEXT_PUBLIC_*` addresses, deployment
artifacts, `script/seed-local.sh`. Deployless would need new machinery this repo does not have:
embedding compiled bytecode into the web bundle plus a drift gate to keep it honest, which is
exactly the apparatus `artifacts/OVRFLOStream.json` and `check-ovrflo-stream-bytecode.mjs` provide
for the fork and which does not exist for main-repo contracts.

An earlier draft also claimed explorer verification comes "for free". **It does not, and that claim
is struck** — it was inflating one side of a decision that stands without it. `foundry.toml` carries
one `[etherscan]` entry, for a Tenderly virtual testnet; there is no mainnet key, and no main-repo
contract has a verification recipe. The only `forge verify-contract` recipe in the tree is scoped to
the fork. **The lens would be the first main-repo contract to be explorer-verified**, so the deploy
step adds a mainnet `[etherscan]` entry and a recipe with `--compiler-version` and
`--optimizer-runs` pinned, in the style of the fork recipe.

Recorded so it is not re-litigated: **deployless is a tested fallback, not a rejected idea.** If
deploy coordination ever becomes the bottleneck, it works today and the switch is a frontend change.

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
- `script/` — a deploy script following the existing pattern
- `web/lib/config.ts`, `web/.env.example` — the lens address
- `web/wagmi.config.ts` / `web/lib/generated.ts` — the ABI
- `web/hooks/useStreams.ts` — hydration becomes one read
- `web/lib/claim-all.ts`, `web/components/borrow/BorrowFlow.tsx` — complete-set reads
- `script/seed-local.sh`, `deployments/local.json` — local deploy
- Maps, gated: `docs/maps/state/keys/chain-reads.md`, regenerated
  `docs/maps/state/functions/INDEX.md`

## Test accountability

- **A reverting stream degrades one row.** Burn a stream between the id read and hydration; assert
  the lens returns `ok: false` for it and correct data for its neighbours. This is the assertion
  that stops the lens regressing from `allowFailure: true`.
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
  `incomplete` failure. Without this, a lens returning empty for *any* reason — wrong address, stale
  ABI after a regen — is indistinguishable from a wallet with no streams, and `watch-entry.ts:49`
  sends a holder to first-run. That is the defect plan `001` records as why the last attempt was
  abandoned. — *useStreams*
- Carry `useStreams.ts:374-381` forward unchanged: a book where **every** row is `ok: false` is
  `unavailable` with a `subcall` failure, never ready-empty. The plan specifies row behavior only. — *useStreams*
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
  local seed deploys the lens and the E2E bootstrap fails loudly if the address is unset. — *useStreams*
- `STREAM_PAGE_SIZE = 25` is justified in its own comment by the four-reads-per-id arithmetic this
  plan removes. Re-derive it from measured per-stream lens gas against a conservative `eth_call` cap,
  and rewrite the rationale comment in the same commit. Plan `004` injects this constant into an E2E
  scenario, so it is not cosmetic. — *lending-math*
- `useLoanStreams` stays on its two-call batch and out of the lens; answer `003`'s snapshot question
  there separately. — *useLoanStreams*

**Deployment pipeline — five files, three gates**

- The address crosses `seed-local.sh` → `deployments/local.json` → `write-env.sh` → `config.ts` →
  `wagmi.config.ts`/`abis.ts`. **`write-env.sh` has both a `jq -e` allow-list assertion and a fixed
  list of `echo "NEXT_PUBLIC_..."` lines** — a variable missing from that echo list never reaches the
  browser regardless of what the artifact holds. The E2E suite does **not** pick the lens up
  automatically. — *ops*
- Use `parseRequiredAddress`, matching `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS`. A zero lens address
  under `parseAddress` would render a populated wallet as empty, which streams-plan R16 forbids.
  Accept that every existing `.env.local` must be reseeded. — *config*
- Add `lens` to the deployment artifact and to `verify-deployment-input.mjs`'s `FIELD_BINDINGS`,
  verified by a non-empty `eth_getCode` check at the pinned block. Every other address is derived
  from on-chain bindings; **a stateless lens has nothing to derive from**, so a code check is the
  deliberate substitute. Without a binding, a wrong lens address ships to production silently. — *ops*
- `test/DeploySize.t.sol` gates deployables through a fixed `string[4]` array referenced in three
  places. Widen it to `string[5]`. — *tests*
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

## The borrow quote does not belong here — it belongs in `borrow`

An earlier revision of this plan put `previewBorrow` on the lens, and proposed exposing a new getter
on `OVRFLOLending` so the lens could reproduce the fill. **Both are withdrawn.** A better seam
already exists in the contract.

### The problem

`StreamPricing`'s `factor`, `grossPrice`, `obligation`, `obligationForFill`, and `fee` are
`internal pure` and therefore uncallable, so `web/lib/lending-math.ts` reimplements all five in
TypeScript — its own comments say "mirrors StreamPricing.*". When the mirror drifts, the UI quotes a
number the contract will not honour.

### Quote by revert

`borrow` already computes the exact quote through the real execution path, and the slippage check
sits **after** the economics and **before** every write, the NFT transfer, and both payments:

```
_validateTick → _fillTick(_priceStream, _selectEpoch, TickTree, flooring, price cap, obligation, fee)
     ↓
minAcceptable check          ← the seam
     ↓
loan storage · sablier.transferFrom · _payUnderlying
```

So enrich the existing error to carry what was computed:

```solidity
error BelowMinAcceptable(uint128 actualBorrow, uint128 feeAmount, uint128 obligation);

if (outcome.actualBorrow - outcome.feeAmount < minAcceptable) {
    revert BelowMinAcceptable(outcome.actualBorrow, outcome.feeAmount, outcome.obligation);
}
```

A quote is then `eth_call borrow(market, aprBps, targetBorrow, streamId, type(uint128).max)`. The
sentinel deliberately fails the slippage check, so the contract runs the **real** tick validation,
stream pricing, epoch selection, TickTree read, fill sizing, fee and obligation — and reverts
carrying the result. The revert rolls back the `filled`, `loanCount`, and cursor writes.

This is the Uniswap V3 Quoter pattern: execute the real path, revert after the economically relevant
computation, decode the revert as the quote. OVRFLO's case is cleaner because the bounded revert
point already exists and needs no new branch.

**Do not add a dedicated quote branch.** The enriched error does the job under its own name in both
situations, and a genuine slippage failure now tells the caller what was actually available — which
is a real improvement to `classifyBorrowError`, not a side effect to tolerate.

A dedicated `BorrowQuote(uint128,uint128,uint128)` error would read more cleanly, but it needs an
explicit quote-mode branch — `if (minAcceptable == type(uint128).max)` — and bytecode is the entire
reason this technique is on the table. Measure the enriched-error form first; it is the smallest.

**Do not touch `FillOutcome`, `_fillTick`, or anything else on the borrow path.** The change is two
hunks: the error declaration and the revert site. The measured +39 bytes assumes exactly that. An
earlier probe widened `FillOutcome` to carry quote-only fields and cost 312 bytes; that approach is
withdrawn and the struct stays as it is.

### Denomination: wei out, UNITs only for coordinates

**The rule:** return internal coordinates in UNITs only when the coordinate itself is the thing being
exposed. Return economic and token amounts in wei.

The three quoted fields are already wei by construction — `actualBorrow` comes back through
`_toWei(fillUnits)`, and `feeAmount` and `obligation` are derived from it. No consumer multiplies by
`UNIT`, and nothing needs converting.

`Borrowed` already encodes this split: `uint64 fillStart` and `uint64 fillEnd` are tape coordinates
in UNITs; `uint128 actualBorrow`, `feeAmount`, and `obligation` are wei. The enriched error takes
exactly those three `uint128` fields, so **the quote and the receipt are the same shape** — one
decoder, identical field semantics.

That currently holds by coincidence. State it as a rule so a later change to the tree's granularity
or compression scheme cannot leak the internal representation into the protocol interface.
`tickDepths`' `availableUnits` staying in UNITs is correct and consistent: there, the compressed book
coordinate *is* what is being exposed.

### Measured

| Approach | Δ bytes | vs the 24,064 canary | Verified |
|---|---|---|---|
| baseline | — | 227 under | 366 / 0 |
| **quote by revert** | **+39** | **188 under** | equivalence proven |
| `previewBorrow`, `bool commit` + block scoping | +312 | 85 over | correct, does not fit |
| `previewBorrow`, view/write split | +403 | 176 over | — |
| `StreamPricing` math externalised | +872 | over EIP-170 | — |

**Equivalence is proven, not argued.** Snapshot, execute a real borrow, capture the `Borrowed`
event, revert the snapshot, then quote with the sentinel and assert the revert encodes exactly those
three values:

```solidity
vm.expectRevert(
    abi.encodeWithSelector(OVRFLOLending.BelowMinAcceptable.selector, execBorrow, execFee, execObl)
);
lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, type(uint128).max);
```

That is stronger than comparing two implementations. Quote and execution are two exits from one.

### Why the sentinel is safe, and the test that pins it

`fillUnits` is `uint64` and `_toWei` multiplies by `UNIT = 1e12`, so the largest representable
`actualBorrow` is about 1.8 × 10^31 against `uint128.max` ≈ 3.4 × 10^38. `actualBorrow - feeAmount`
can never reach the sentinel, so the MAX call always reaches the revert.

**Pin that with a test.** A future widening of `fillUnits` or `UNIT` would silently break quoting.

### Test accountability for the quote

Three existing tests fail on the enriched error, all test-side decoding, none a contract defect:

- `test_Borrow_ConcurrentTargets_SecondRevertsBelowMinAcceptable` and
  `test_Borrow_MinAcceptableComparesNetOfFee` use `vm.expectRevert(…​.selector)`, which requires an
  exact four-byte match. Use `vm.expectPartialRevert`, or encode the full expected error.
- `testFuzz_Lending_WithdrawFrontRunningBorrowIsBenign` parses revert data by length and reports
  `100 != 4`.

The differential must cover, each asserting quote equals execution: partial tick fill,
stream-price-capped fill, full stream sale, UNIT flooring, zero fee, non-zero fee, dust below
`MIN_LIQUIDITY_AMOUNT`, dead-epoch skipping, the `CURSOR_CAP` boundary, `EpochBacklog`, and the
maturity boundary.

### What the quote does not prove

It stops before `sablier.transferFrom`, so it does not establish that the caller owns the NFT, that
the market is approved, or that the final transfers succeed. **That is a feature** — it lets the UI
preview before asking for approval. The flow is:

```
quote by revert   → economic preview
approve stream    → only if the user proceeds
simulate the real borrow, real minAcceptable, real sender → transaction authority
send
```

Which matches `2026-08-15-003`'s rule that simulation, not display, is transaction authority.

### What this leaves for the lens

Almost nothing. The lens does **not** compute the quote. At most it becomes a thin adapter that
calls `borrow` with the sentinel, catches the expected error, returns a struct, and bubbles every
other revert unchanged — `InvalidTick`, `BelowMinimum`, `EpochBacklog`, and the `StreamPricing`
eligibility errors all stay canonical.

The rich frontend can decode the custom error with viem directly and skip the adapter entirely.
**Build in this order, and stop as soon as it is enough:**

1. Enrich the error in `OVRFLOLending`.
2. Decode it in `web/`, deleting the five mirrored functions in `web/lib/lending-math.ts`.
3. Test behaviour through the injected provider.
4. Add the normalising adapter **only** if provider compatibility demands it.

Do not deploy another contract unless it earns its existence.

### If it ever stops fitting

Ranked, so the next attempt does not restart from the worst option:

1. Quote by revert inside the existing `borrow`.
2. Evaluate whether a lower-value external view can be removed to make room — for example whether
   the single-pair `contributionOf` still earns its bytes.
3. A minimal canonical fill-state getter plus a lens using `StreamPricing`.
4. **Not** externalising `StreamPricing`'s arithmetic. Measured: it grows the contract by 173 bytes,
   because the call stubs cost more than the inlined bodies.

`web/lib/lending-math.ts`'s five mirrored functions and their tests are what this deletes.


## Out of scope

- Any change to the lockup. The lens reads what exists.
- The pager (`001`), the pin (`003`), the contract index (`002`).
- A lens for the lending books. `lenderPositionAt` and `borrowerLoanAt` are append-only and their
  hydration is not a four-call fan-out; revisit only if measurement says otherwise.
- Writing through the lens. It is a view contract and stays one.
