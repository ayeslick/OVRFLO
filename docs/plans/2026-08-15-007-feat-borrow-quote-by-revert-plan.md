# Borrow quote by revert

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Repository: `OVRFLO` (main). Changes `src/OVRFLOLending.sol` and `web/`.
Split out of `2026-08-15-005` on 2026-08-15: that plan is a periphery read contract, this is a core
contract change. They share a problem shape and nothing else, and they ship independently.

## Problem

`StreamPricing`'s `factor`, `grossPrice`, `obligation`, `obligationForFill`, and `fee` are
`internal pure` and therefore uncallable from outside. So `web/lib/lending-math.ts` reimplements all
five in TypeScript — its own comments say "mirrors StreamPricing.*".

Two hand-maintained implementations of the same pricing, in two languages, that must agree. When
they drift the UI quotes a number the contract will not honour: the user signs, and either the
transaction reverts or it succeeds on different terms than were displayed.

`OVRFLOLending` has three external views — `contributionOf`, `tickDepths`, `loanState`. None of them
quotes a borrow.

## The seam that already exists

`borrow` computes the exact quote through the real execution path, and the slippage check sits
**after** the economics and **before** the loan write, the NFT transfer, and both payments.
`_fillTick`'s own tick writes (`filled`, `loanCount`, the cursor) have already executed by the seam;
the revert rolls them back. The guarantee is **no persistent state change**, not "no writes
executed":

```
_validateTick → _fillTick(_priceStream, _selectEpoch, TickTree, flooring, price cap, obligation, fee)
     ↓
minAcceptable check          ← the seam
     ↓
loan storage · sablier.transferFrom · _payUnderlying
```

Verified at `src/OVRFLOLending.sol`: the revert is the first statement after `_fillTick`, and the
first post-seam storage write (the loan) is two lines later.

## Product contract

- One implementation of the fill. The quote is the execution with its writes rolled back, not a
  second copy of the arithmetic.
- The quote leaves no persistent state change — `_fillTick`'s writes are rolled back by the
  revert — and never reaches the NFT transfer or a payment.
- `web/lib/lending-math.ts`'s five mirrored functions are deleted, not left as a fallback.
- A genuine slippage failure reports what was actually available.
- No new contract, no new getter, no new external function.
- **The quote becomes asynchronous.** The borrow screen must stay usable while it is in flight, and
  must never show a figure the contract did not produce.

## The quote stops being free — decide the interaction shape

This is the one consequence that is not a contract concern, and it is the thing an implementer will
otherwise settle silently at the keyboard.

Today `BorrowFlow.tsx:241` computes the quote **synchronously during render**:

```ts
const quote: BorrowQuote | null =
  selectedStream && selectedAprBps !== null && lendingConfig
    ? quoteBorrow({ remaining, aprBps: selectedAprBps, … })
```

Pure arithmetic, recomputed on every keystroke, free. After this change each recompute is an
`eth_call`. Three decisions follow, and the plan settles them rather than leaving them to taste:

**Debounce the amount input, not the tick selection.** Typing an amount produces a keystroke per
character; choosing an APR tick is one discrete act. Debounce the former, quote the latter
immediately.

**An in-flight quote shows the previous figures, marked stale — never zero and never blank.** The
figures on this screen are money. A field that empties while the user types reads as "you get
nothing", which is the same class of collapse `2026-08-15-006` removes from the bootstrap path.

**`quoteDrift` and `snapshotQuote` keep their job, and it gets easier.** They exist to compare a
frozen quote against a live one. "Live" stops being a local recomputation and becomes the contract's
own answer, which is what the comparison always wanted. State whether drift is re-checked on an
interval or only at the review step; do not leave both plausible.

The write boundary is unchanged: the quote is display, and the real `borrow` simulation with the
user's actual `minAcceptable` remains transaction authority (`2026-08-15-003`).

## The change

**Contract — two hunks, nothing else:**

```solidity
-error BelowMinAcceptable();
+error BelowMinAcceptable(uint128 actualBorrow, uint128 feeAmount, uint128 obligation);

-if (outcome.actualBorrow - outcome.feeAmount < minAcceptable) revert BelowMinAcceptable();
+if (outcome.actualBorrow - outcome.feeAmount < minAcceptable) {
+    revert BelowMinAcceptable(outcome.actualBorrow, outcome.feeAmount, outcome.obligation);
+}
```

**Do not touch `FillOutcome`, `_fillTick`, `_selectEpoch`, or anything else on the borrow path.** The
measured cost assumes exactly these two hunks. An earlier probe widened `FillOutcome` to carry
quote-only fields and cost 312 bytes; that approach is withdrawn.

**Frontend:** `eth_call borrow(market, aprBps, targetBorrow, streamId, type(uint128).max)`, decode
the error with viem, delete the five mirrored functions and their tests, and teach
`classifyBorrowError` the new payload.

The sentinel deliberately fails the slippage check, so the contract runs the real tick validation,
stream pricing, epoch selection, TickTree read, fill sizing, fee, and obligation — then reverts
carrying the result. The revert rolls back the `filled`, `loanCount`, and cursor writes.

This is the Uniswap V3 Quoter pattern: execute the real path, revert after the economically relevant
computation, decode the revert as the quote. OVRFLO's case is cleaner because the bounded revert
point already exists and needs no new branch.

**Do not add a dedicated quote branch.** A `BorrowQuote(uint128,uint128,uint128)` error reads more
cleanly but needs `if (minAcceptable == type(uint128).max)`, and bytecode is the entire reason this
technique is on the table. The enriched error does the job under its own name in both situations.

## Measured

| Approach | Δ bytes | vs the 24,064 canary | Verified |
|---|---|---|---|
| baseline | — | 227 under | 366 / 0 |
| **quote by revert** | **+39** | **188 under** | equivalence proven |
| `previewBorrow`, `bool commit` + block scoping | +312 | 85 over | correct, does not fit |
| `previewBorrow`, view/write split | +403 | 176 over | — |
| `StreamPricing` math externalised | +872 | over EIP-170 | — |

Equivalence is proven, not argued. Snapshot, execute a real borrow, capture the `Borrowed` event,
revert the snapshot, then quote with the sentinel and assert the revert encodes exactly those three
values:

```solidity
vm.expectRevert(
    abi.encodeWithSelector(OVRFLOLending.BelowMinAcceptable.selector, execBorrow, execFee, execObl)
);
lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, type(uint128).max);
```

Stronger than comparing two implementations: quote and execution are two exits from one.

## Why the sentinel is safe

`fillUnits` is `uint64` and `_toWei` multiplies by `UNIT = 1e12`, so the largest representable
`actualBorrow` is about 1.8 × 10^31 against `uint128.max` ≈ 3.4 × 10^38. `actualBorrow - feeAmount`
can never reach the sentinel, so the MAX call always reaches the revert.

**Pin that with a test.** Widening `fillUnits` or `UNIT` later would break quoting silently.

## Denomination: wei out, UNITs only for coordinates

**The rule:** return internal coordinates in UNITs only when the coordinate itself is the thing being
exposed. Return economic and token amounts in wei.

The three quoted fields are already wei — `actualBorrow` comes back through `_toWei(fillUnits)`, and
`feeAmount` and `obligation` derive from it. No consumer multiplies by `UNIT`.

`Borrowed` already encodes the split: `uint64 fillStart` and `uint64 fillEnd` are tape coordinates in
UNITs; `uint128 actualBorrow`, `feeAmount`, and `obligation` are wei. The enriched error takes
exactly those three `uint128` fields, so **the quote and the receipt are the same shape** — one
decoder, identical field semantics.

That currently holds by coincidence. Stated as a rule so a later change to the tree's granularity
cannot leak the internal representation into the protocol interface. `tickDepths`' `availableUnits`
staying in UNITs is consistent, not an exception: there the compressed book coordinate *is* what is
being exposed.

## What the quote does not prove

It stops before `sablier.transferFrom`, so it does not establish that the caller owns the NFT, that
the stream NFT is approved for transfer, or that the post-seam transfers succeed. Market approval
**is** established: the quote runs the existing validation path before the fill, so an unapproved
market fails the quote with its own error rather than returning numbers.

**That is a feature** — it lets the UI preview before asking for approval:

```
quote by revert   → economic preview
approve stream    → only if the user proceeds
simulate the real borrow, real minAcceptable, real sender → transaction authority
send
```

Which matches `2026-08-15-003`'s rule that simulation, not display, is transaction authority.

## Files (when built)

- `src/OVRFLOLending.sol` — the two hunks
- `test/OVRFLOLending.t.sol` — the differential, the sentinel pin, and the three repairs below
- `web/lib/lending-math.ts` — delete `factor`, `factorWad`, `grossPrice`, `obligation`,
  `obligationForFill`, `fee`, `netToBorrower`
- `web/tests/lib/lending-math.test.ts` — delete their tests
- `web/components/borrow/quote.ts` — **edited, not deleted** (below)
- `web/components/borrow/BorrowFlow.tsx` — the render-time call becomes an async read
- `web/lib/borrow.ts` — `classifyBorrowError` learns the payload
- `web/lib/generated.ts` — regenerated; the error signature changed
- Maps, gated: `docs/maps/state/keys/chain-reads.md` and the regenerated
  `docs/maps/state/functions/INDEX.md`

### `quote.ts` is a mixed module

Verified: the five mirrored functions have **exactly one consumer in the whole frontend** —
`web/components/borrow/quote.ts`. Nothing in `lib/`, `hooks/`, or `app/` touches them, and
`payoff.ts` imports `streamBuckets` rather than any pricing function, so loan interpolation and
cover-date projection are unaffected.

But `quote.ts` is 181 lines and only **two** of its exports are pricing — `quoteBorrow` and
`streamDerivedCap`. The other nine are presentation concerns that stay: `snapshotQuote`,
`quoteDrift`, `tickDepthWei`, `liveRungs`, `liveTickCopy`, `ttmSeconds`, `loanCover`,
`fullRepayCoverPreview`, `weiToAmountInput`, `poolFractions`. Five components import from it —
`BorrowFlow`, `Facts`, `PoolBand`, `ReviewHandoff`, `RateStep`.

Replace the two pricing exports. Leave the rest.

**Two of the deletions are already dead code.** `factor` / `factorWad` and `netToBorrower` have zero
consumers today, before this change. Removing them is not deferred cleanup riding along; they are
unreachable now.

## Test accountability

Three existing tests fail on the enriched error. All are test-side decoding, none a contract defect:

- `test_Borrow_ConcurrentTargets_SecondRevertsBelowMinAcceptable` and
  `test_Borrow_MinAcceptableComparesNetOfFee` use `vm.expectRevert(…​.selector)`, which requires an
  exact four-byte match. Use `vm.expectPartialRevert`, or encode the full expected error.
- `testFuzz_Lending_WithdrawFrontRunningBorrowIsBenign` parses revert data by length and reports
  `100 != 4`.

New cases required:

- **The differential**, asserting quote equals execution across: partial tick fill,
  stream-price-capped fill, full stream sale, UNIT flooring, zero fee, non-zero fee, dust below
  `MIN_LIQUIDITY_AMOUNT`, dead-epoch skipping, the `CURSOR_CAP` boundary, `EpochBacklog`, and the
  maturity boundary.
- **The sentinel pin**, so a future widening of `fillUnits` or `UNIT` fails loudly.
- **State is unchanged after a quote.** Assert `filled`, `loanCount`, and the epoch cursor are
  identical before and after the MAX call.
- **Frontend decode.** A Vitest case asserting the decoded quote equals what a subsequent borrow
  produces, replacing the deleted mirrored-function tests.
- **An in-flight quote never shows zero.** Assert the borrow figures hold their previous values,
  marked stale, while a new quote is outstanding — the failure this guards is a money field reading
  as "you get nothing" mid-keystroke.
- **Debounce holds under fast input.** Assert that typing an amount issues one quote rather than one
  per character, and that changing the APR tick quotes immediately.

## Out of scope

- The stream lens. See `2026-08-15-005`. This plan adds no contract and no getter.
- Any change to `FillOutcome`, `_fillTick`, or the borrow path's structure.
- Externalising `StreamPricing`. Measured at +173 bytes; the call stubs cost more than the inlined
  bodies.

### If it ever stops fitting

Ranked, so a future attempt does not restart from the worst option. **None of these is authorised
work today** — quote by revert fits with 188 bytes to spare.

1. Quote by revert inside the existing `borrow`.
2. Evaluate whether a lower-value external view can be removed to make room — for example whether
   the single-pair `contributionOf` still earns its bytes.
3. A minimal canonical fill-state getter plus a lens using `StreamPricing`.
4. **Not** externalising `StreamPricing`'s arithmetic.
