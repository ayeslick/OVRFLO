# Borrow quote — direct `previewBorrow` under via-IR

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Repository: `OVRFLO` (main). Changes `foundry.toml`, `src/OVRFLOLending.sol`, and `web/`.
Split out of `2026-08-15-005` on 2026-08-15: that plan is a periphery read contract, this is a core
contract change. They share a problem shape and nothing else, and they ship independently.

**Design superseded 2026-08-15, by measurement.** This plan originally specified quote-by-revert
(enrich `BelowMinAcceptable`, quote via a sentinel `minAcceptable` that deliberately fails). That
design existed for exactly one reason: the direct preview did not fit under EIP-170 with the
compiler settings of the day. The `008` compiler sweep (throwaway worktree at `917e709`, solc
pinned 0.8.36) showed the constraint was self-imposed — `via_ir = true` at the existing 200
optimizer runs shrinks `OVRFLOLending` by 2,581 bytes and *improves* hot-path gas. All four
pre-agreed win conditions held, so the direct preview wins and the revert machinery is retired.
Quote-by-revert remains the recorded fallback (measured +39 bytes under the legacy pipeline) if
via-IR ever has to be abandoned; it is not authorised work.

## Problem (unchanged)

`StreamPricing`'s `factor`, `grossPrice`, `obligation`, `obligationForFill`, and `fee` are
`internal pure` and therefore uncallable from outside. So `web/lib/lending-math.ts` reimplements all
five in TypeScript — its own comments say "mirrors StreamPricing.*".

Two hand-maintained implementations of the same pricing, in two languages, that must agree. When
they drift the UI quotes a number the contract will not honour: the user signs, and either the
transaction reverts or it succeeds on different terms than were displayed.

`OVRFLOLending` has three external views — `contributionOf`, `tickDepths`, `loanState`. None of them
quotes a borrow.

## Product contract

- One implementation of the fill. `previewBorrow` runs the same `_validateTick` → `_fillTick`
  path `borrow` runs, with writes gated off — not a second copy of the arithmetic.
- The quote leaves no state change: the commit flag skips the cursor advance and the packed
  `filled`/`loanCount` write, and the preview never reaches the NFT transfer or a payment.
- `web/lib/lending-math.ts`'s five mirrored functions are deleted, not left as a fallback.
- A genuine slippage failure still reports through `BelowMinAcceptable` — **whose signature does
  not change**. No error changes, no selector changes, nothing the frontend already decodes breaks.
- No new deployed contract. One new external function on `OVRFLOLending`.
- **The quote becomes asynchronous.** The borrow screen must stay usable while it is in flight, and
  must never show a figure the contract did not produce.

## The change

**`foundry.toml` — the flip, indivisible from the function:**

```toml
via_ir = true
```

The adoption bundle cannot be split: flipping via-IR without landing `previewBorrow` re-baselines
every size figure for nothing, and landing `previewBorrow` without the flip does not fit (85 over
the canary under the legacy pipeline). One commit carries both, plus the re-baselined measured
table below.

**`src/OVRFLOLending.sol` — commit-flag threading plus one external function.** The probe diff in
`.scratch/preview-probe/` is the reference implementation; it is small enough to restate:

- `_fillTick(market, aprBps, targetBorrow, streamId, bool commit)` — the two packed-slot writes
  (`epochState.filled`, `epochState.loanCount`) execute only when `commit` is true.
- `_selectEpoch(tick, bool commit)` — the `oldestLiveEpoch` cursor advance executes only when
  `commit` is true. The epoch *selection* logic is identical either way, including the
  `EpochBacklog` revert at `CURSOR_CAP`.
- `borrow` calls `_fillTick(…, true)`. Nothing else about `borrow` changes — not the error, not
  the seam, not the event.
- New:

```solidity
/// @notice Quotes a borrow through the real fill path without consuming liquidity.
function previewBorrow(address market, uint16 aprBps, uint128 targetBorrow, uint256 streamId)
    external
    returns (uint128 actualBorrow, uint128 feeAmount, uint128 obligation)
```

`previewBorrow` is deliberately **non-view**: `_fillTick` and `_selectEpoch` stay `internal`
non-view (the commit branch writes), and view-ness buys nothing — the frontend reaches it through
`eth_call`, where a non-view function with no executed writes behaves identically. Do not build the
view/write split; it was measured at +403 under the legacy pipeline and buys a modifier keyword.

**The quote branch is no longer a byte concern.** The original design rejected any dedicated quote
branch because bytes were the whole game. Under via-IR the commit flag costs are absorbed into
1,258 bytes of canary headroom — but the branch is now load-bearing for correctness, so it gets a
dedicated state-unchanged test (below) instead of a byte justification.

**Frontend:** `eth_call previewBorrow(market, aprBps, targetBorrow, streamId)`, decode three named
return values like any other read. Delete the five mirrored functions and their tests.
`classifyBorrowError` is untouched — no error changed. MAX (decided 2026-08-15, unchanged by the
redesign) is `previewBorrow` with a huge `targetBorrow` (`type(uint128).max`): its `actualBorrow`
**is** the maximum borrowable at current liquidity, because the fill clamps to
`min(target, epoch liquidity, stream price cap)`. The stream-only theoretical cap stays unshown —
a number the user cannot act on when liquidity binds.

**ABI: additive, no `ABI_VERSION` bump.** `2026-08-15-005`'s sweep defines the bump as "breaking
changes to ABIs the frontend already consumes". Adding `previewBorrow` is additive and
`BelowMinAcceptable` keeps its zero-argument signature, so nothing already consumed changes shape.
The regenerated `web/lib/generated.ts` gains one function. (The superseded design changed a decoded
error's selector and did require the bump; that obligation dies with it.)

## The interaction shape (unchanged by the redesign)

Today `BorrowFlow.tsx:241` computes the quote **synchronously during render** — pure arithmetic,
recomputed on every keystroke, free. After this change each recompute is an `eth_call`. The
decisions, settled here rather than at the keyboard:

**Debounce the amount input, not the tick selection.** Typing an amount produces a keystroke per
character; choosing an APR tick is one discrete act. Debounce the former, quote the latter
immediately.

**An in-flight quote shows the previous figures, marked stale — never zero and never blank.** The
figures on this screen are money. A field that empties while the user types reads as "you get
nothing", which is the same class of collapse `2026-08-15-006` removes from the bootstrap path.

**`quoteDrift` and `snapshotQuote` keep their job, and it gets easier.** They compare a frozen
quote against a live one. "Live" stops being a local recomputation and becomes the contract's own
answer, which is what the comparison always wanted. Drift is re-checked at the review step, not on
an interval.

**The quote composes only with same-block state.** BorrowFlow derives figures like
`residual = selectedStream.remaining - obligation` from the already-loaded stream object, which
under `2026-08-15-003` may be an older display snapshot. Rule: any figure composed from the quote
plus stream state hydrates the selected stream at quote time — `streamsByIds([streamId])` from the
`2026-08-15-005` lens — or is explicitly labeled as snapshot-derived. The protocol client makes
this structural by producing one named artifact,
`BorrowQuoteSnapshot { block: {N, H}, actualBorrow, fee, obligation, streamRemaining, residual }`,
where every constituent read is from block `N` — mixed-block figures never coexist in one object.

**Latest request wins.** Quotes are async and can return out of order. Make the quote a TanStack
**query** keyed on `{chainId, lending, market, streamId, aprBps, targetBorrow}`, not an imperative
fetch; key-scoped caching and in-flight ownership discard stale results by construction.

The write boundary is unchanged: the quote is display, and the real `borrow` simulation with the
user's actual `minAcceptable` remains transaction authority (`2026-08-15-003`).

## via-IR safety net

via-IR has a real miscompile history. The pinned solc 0.8.36 is the release that fixes all three
2026 registry entries — including SOL-2026-2 (`UnsoundSpillInMutualRecursion`, via-IR-only, latent
since 0.7.2) — and the official registry shows **no unfixed known bug at 0.8.36** (verified
2026-08-15). OVRFLO's `src/` contains none of the historical trigger shapes: no inline assembly,
no transient storage, no `verbatim`, no recursion on the money paths. The registry only lists
bugs already found, so the defense is standing gates, not a one-time check:

- **Storage-layout golden.** Commit `forge inspect <contract> storage-layout` for every production
  contract; CI asserts the layout is byte-identical under both compiler pipelines. (0.8.36's own
  changelog fixed an inheritance-order analysis bug — layout is exactly where pipeline differences
  would corrupt silently.)
- **Raw-slot packing tests.** `vm.load` assertions on the packed `Epoch` slot after real borrows:
  `filled` and `loanCount` share one slot, the single most codegen-sensitive write in the protocol.
- **Dual-pipeline differential gate.** The full suite plus the invariant campaigns run under
  **both** legacy and via-IR before deploy; both must be green. Two independent code generators
  agreeing is the cheapest miscompile detector available. (The probe already demonstrated the
  value: via-IR bytecode changes the fuzzer's mined dictionary, which surfaced a latent
  invariant-handler underflow, fixed in `917e709`.)
- **Deploy-gate registry check.** Re-check the official `bugs_by_version` for the pinned solc on
  deploy day.
- **Standing rule.** No new assembly, transient storage, or recursion enters `src/` without
  re-running this assessment.

## Measured (re-baselined 2026-08-15, solc 0.8.36 pinned)

| Configuration | Runtime bytes | vs the 24,064 canary | Suite |
|---|---|---|---|
| legacy pipeline, baseline (shipping today) | 23,837 | 227 under | 366 / 0 |
| via-IR, baseline | 21,256 | 2,808 under | 366 / 0 |
| **via-IR, `previewBorrow`** | **22,806** | **1,258 under** | **366 / 0** |
| legacy pipeline, `previewBorrow` | 24,149 | 85 over | correct, does not fit |

Borrow gas: 261,348 (via-IR + preview) vs 261,274 (via-IR baseline, +74 noise) vs 267,602 (legacy
shipping today) — the bundle *improves* production borrow gas by ~6,250. Recorded because it is
non-obvious: the preview variant cost +312 bytes under legacy but +1,550 under via-IR. Size deltas
do not transfer across pipelines; only measurement settles a fit question.

## Denomination: wei out, UNITs only for coordinates (unchanged)

`previewBorrow`'s three returns are wei — `actualBorrow` comes back through `_toWei(fillUnits)`,
and `feeAmount` and `obligation` derive from it. `Borrowed` already encodes the same split, so
**the quote and the receipt are the same shape** — identical field semantics. `tickDepths`'
`availableUnits` staying in UNITs is consistent, not an exception: there the compressed book
coordinate *is* what is being exposed.

## What the quote does not prove (unchanged)

`previewBorrow` stops before `sablier.transferFrom`, so it does not establish that the caller owns
the NFT, that the stream NFT is approved for transfer, or that the post-seam transfers succeed.
Market approval **is** established: the preview runs the existing validation path before the fill,
so an unapproved market fails the quote with its own error rather than returning numbers.

**That is a feature** — it lets the UI preview before asking for approval:

```
previewBorrow     → economic preview
approve stream    → only if the user proceeds
simulate the real borrow, real minAcceptable, real sender → transaction authority
send
```

## Files (when built)

- `foundry.toml` — `via_ir = true`
- `src/OVRFLOLending.sol` — commit-flag threading, `previewBorrow`
- `test/OVRFLOLending.t.sol` — the differential, the state-unchanged test, raw-slot packing
- `test/` — storage-layout golden check (new), dual-pipeline CI gate
- `web/lib/lending-math.ts` — delete `factor`, `factorWad`, `grossPrice`, `obligation`,
  `obligationForFill`, `fee`, `netToBorrower`
- `web/tests/lib/lending-math.test.ts` — delete their tests
- `web/components/borrow/quote.ts` — **edited, not deleted** (below)
- `web/components/borrow/BorrowFlow.tsx` — the render-time call becomes an async read
- `web/lib/generated.ts` — regenerated; one function added, no error changed, no `ABI_VERSION` bump
- Maps, gated: `docs/maps/state/keys/chain-reads.md` and the regenerated
  `docs/maps/state/functions/INDEX.md`

### `quote.ts` is a mixed module (unchanged)

Verified: the five mirrored functions have **exactly one consumer in the whole frontend** —
`web/components/borrow/quote.ts`. Only **two** of its eleven exports are pricing — `quoteBorrow`
and `streamDerivedCap`. The other nine are presentation concerns that stay. Replace the two:
`quoteBorrow`'s successor is the `previewBorrow` read; `streamDerivedCap`'s successor is the MAX
quote (huge `targetBorrow`, decided above). `factor` / `factorWad` and `netToBorrower` are already
dead code — zero consumers today.

## Test accountability

The superseded design broke three existing tests on the enriched error signature. **The redesign
breaks none** — `BelowMinAcceptable` is untouched, so
`test_Borrow_ConcurrentTargets_SecondRevertsBelowMinAcceptable`,
`test_Borrow_MinAcceptableComparesNetOfFee`, and
`testFuzz_Lending_WithdrawFrontRunningBorrowIsBenign` stand as written.

New cases required:

- **The differential**, asserting `previewBorrow` equals a subsequent real `borrow`'s
  `Borrowed` event across: partial tick fill, stream-price-capped fill, full stream sale, UNIT
  flooring, zero fee, non-zero fee, dust below `MIN_LIQUIDITY_AMOUNT`, dead-epoch skipping, the
  `CURSOR_CAP` boundary, `EpochBacklog`, and the maturity boundary.
- **State is unchanged after a preview.** Assert `filled`, `loanCount`, and the epoch cursor are
  identical before and after, including the raw packed slot via `vm.load` — this is the commit
  branch's dedicated test, and the via-IR packing canary.
- **Preview then borrow in one block agree** — the two exits from the shared path cannot drift by
  construction, but the test documents the guarantee.
- **Storage-layout golden and dual-pipeline gates** per the safety net above.
- **Frontend decode.** A Vitest case asserting the decoded preview equals what a subsequent borrow
  produces, replacing the deleted mirrored-function tests.
- **An in-flight quote never shows zero.** Borrow figures hold their previous values, marked
  stale, while a new quote is outstanding.
- **Debounce holds under fast input.** Typing an amount issues one quote, not one per character;
  changing the APR tick quotes immediately.

## Out of scope

- The stream lens. See `2026-08-15-005`. This plan adds no deployed contract.
- Externalising `StreamPricing`. Measured at +872 under legacy; moot under via-IR headroom, still
  worse than the shared-path design on drift grounds.
- Any `optimizer_runs` change. The runs axis was measured dead (`runs=1` buys 221 bytes and taxes
  every runtime call); 200 stays.

### Fallback, ranked (none authorised today)

1. **Quote-by-revert** — the superseded design, kept measured and whole in git history at
   `5213e59`: enrich `BelowMinAcceptable(uint128,uint128,uint128)`, sentinel
   `minAcceptable = type(uint128).max`, +39 bytes under legacy. Sound, proven pattern (Uniswap V3
   Quoter); retired only because the direct call is simpler to consume and via-IR made the byte
   argument moot. If via-IR itself is ever abandoned, this returns.
2. Evaluate whether a lower-value external view can be removed to make room — for example whether
   the single-pair `contributionOf` still earns its bytes.
3. **Not** externalising `StreamPricing`'s arithmetic.
