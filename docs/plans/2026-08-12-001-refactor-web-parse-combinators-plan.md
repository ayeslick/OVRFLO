# Plan — Inferred-output parser combinators for `web/lib/parse.ts`

**Status:** drafted, **not build-ready** (no ignorance-lens sweep run — see
"Gate" below).
**Type:** refactor / hardening. No product behaviour change.
**Origin:** evaluation of Zod (<https://zod.dev>) for the Markets frontend.
Zod is **not** adopted; this plan salvages one idea from its design and adds no
runtime dependency, so `ovrflo-web-standard.md` **D1** does not trigger.

---

## 1. Problem

Persisted-state parsing is guarded by hand-written type predicates passed into a
generic reader:

- `parseJsonStorage<T>(raw, guard: (value: unknown) => value is T)` —
  `web/lib/parse.ts:204`
- `isBlockIdentity` — `web/lib/storage.ts:45`
- `isDecimalIdList` — `web/lib/storage.ts:119`
- `isRecoverableReceipt` — `web/lib/receipts.ts:24`
- `parseDraftShape` — `web/lib/parse.ts:161`

A `value is T` predicate is an **unchecked author assertion**. TypeScript
verifies nothing about whether the function body actually establishes `T`. A
guard that narrows a field's type, or that omits a field the type later gains as
optional, keeps compiling and keeps returning `true` for values that are not `T`.
`localStorage` is a trust boundary, so this is a soundness hole at exactly the
place the codebase already treats as untrusted (`web/lib/storage.ts:6-8`).

`parseDraftShape` additionally encodes per-field validity using `undefined` as a
sentinel distinct from a legitimately-`null` field (`web/lib/parse.ts:164-184`) —
correct today, but the subtlety is repeated per field and per new key.

**What Zod does differently:** the output type is *derived from* the parser
(`z.infer`), so the assertion cannot disagree with the type. That property is
reproducible in ~60 lines here.

---

## 2. Scope

### In

1. A combinator core in `web/lib/parse.ts` whose parsers return the existing
   `ParseResult<T>` (`web/lib/parse.ts:4-6`) and whose output type is inferred
   from the parser value, not declared alongside it.
2. Migrate the five sites listed in §1 onto it.
3. Extend the three existing test files that already own this surface.

### Out — and why

- **A schema library (Zod, valibot, arktype).** New runtime dependency; **D1**
  (`docs/solutions/patterns/ovrflo-web-standard.md:158`) makes that a MUST-gated
  KTD amendment, and the boundary is too small to justify one.
- **Payload version tags / migration.** This is the change that would eventually
  force a dependency, but it alters the persisted wire format and requires an
  "untagged means v1" compatibility path for already-deployed browsers. Real
  work, real risk; it does not belong in a small plan. Revisit when a persisted
  shape first needs to change incompatibly.
- **URL-param parsers** (`parseWatchLens`, `parseEntityId`, `parseTickParam`,
  `parseWatchSearch`, `parseAddressParam`). These correctly collapse to `null →
  default`; the failure reason is genuinely uninteresting for a bad query
  string. Leave them.
- **`parseDecimalInput`** (`web/lib/parse.ts:104`). Locale-aware decimal → `Wei`
  is domain math, not shape validation. Untouched.
- **Any user-facing surfacing of a corrupt-state reason.** UI meaning lives in
  `docs/maps/ui/` and briefs win; this plan does not invent product behaviour.

---

## 3. Constraint: the public API does not change

Every exported reader keeps its current signature and its current
`T | null` / `[]` collapse:

- `readCheckpoint` — `web/lib/storage.ts:53`
- `readFlowDraft` — `web/lib/storage.ts:108`
- `readCandidateIds` — `web/lib/storage.ts:124`
- `readReceipt` — `web/lib/receipts.ts:49`

This is load-bearing, not merely convenient. `web/hooks/useStreams.ts:141`
types its state as `ReturnType<typeof readCheckpoint>`, so a changed return type
propagates into hook state. Holding the boundary means **no edits** are required
in `web/hooks/useStreams.ts`, `web/components/supply/SupplyFlow.tsx:158`, or
`web/components/borrow/BorrowFlow.tsx:165`.

The failure reason becomes available *inside* `parseJsonStorage` as a natural
consequence of combinators returning `ParseResult` — it is not plumbed to a new
sink, and no new consumer is invented for it (YAGNI).

---

## 4. Work

**W1 — combinator core** (`web/lib/parse.ts`).
Add a `Parser<T>` alias over the existing `ParseResult<T>`, an `Infer<P>`
conditional type, and the minimum combinator set the five call sites actually
need: string, integer, the `null`-or-`undefined`-tolerant wrapper matching the
semantics already at `web/lib/parse.ts:164-184`, array-of, address (delegating
to viem's `isAddress`, already imported at `web/lib/parse.ts:1`), literal-union,
and object-shape. No combinator is added that no call site uses.

Reuse the existing `ok` / `err` constructors (`web/lib/parse.ts:29-35`) and the
existing `ParseErr["reason"]` union — do not widen it.

**W2 — migrate `parseDraftShape`** (`web/lib/parse.ts:161`).
Express the shape via W1. `FlowDraft` (`web/lib/parse.ts:18`) becomes the
inferred type of that parser rather than a separate declaration. Its four public
field names and their nullability must be identical afterward — the type is
consumed by `web/lib/storage.ts:108` and both flow components.

**W3 — migrate the three storage guards.**
`isBlockIdentity` (`web/lib/storage.ts:45`), `isDecimalIdList`
(`web/lib/storage.ts:119`), `isRecoverableReceipt` (`web/lib/receipts.ts:24`)
become combinator parsers. `parseJsonStorage` (`web/lib/parse.ts:204`) takes a
`Parser<T>` instead of a type predicate; its own signature keeps returning
`T | null`.

Preserve the specific predicates these guards enforce today, which are stricter
than shape alone — the 32-byte hash pattern at `web/lib/storage.ts:47` and the
decimal-string pattern at `web/lib/storage.ts:120`. A combinator that only
checks `typeof === "string"` is a regression.

**W4 — bigint transport is unchanged.**
`stringifyWithBigint` / `parseWithBigint` (`web/lib/parse.ts:133-159`) and the
`$ovrflo/bigint` tag stay exactly as they are. Combinators operate on the
already-revived value, as `parseJsonStorage` does today at
`web/lib/parse.ts:209-211`.

---

## 5. Test accountability

Extend the files that already own these paths — no new suite.

- `web/tests/lib/parse.test.ts` — currently asserts `parseFlowDraft` rejects
  non-JSON, a bare array, and `null` (lines 51-53) and round-trips a draft
  (line 101). **Successor scenario to add:** a draft whose `selectedMarket` is a
  syntactically-plausible but non-checksum-valid string is rejected, and a draft
  whose `selectedAprBps` is a non-integer number is rejected — the two cases
  where the old sentinel logic and a naive combinator diverge.
- `web/tests/hooks/storage.test.ts` — currently asserts `readCheckpoint`
  returns `null` for absent/corrupt data (line 33) and reads back a written
  checkpoint (line 42). **Successor scenario to add:** a stored checkpoint whose
  `hash` is a hex string of the wrong length is rejected, proving W3 preserved
  the `web/lib/storage.ts:47` pattern rather than degrading to a `typeof` check.
- `web/tests/hardening/drafts.test.ts` — currently covers per-kind and
  per-account draft isolation (lines 60-64) and foreign-shape rejection
  (line 68). **Successor scenario to add:** a draft persisted with an extra
  unknown field still restores its four known fields, pinning the
  forward-compatibility behaviour that a future version tag would otherwise
  change silently.

---

## 6. Verification

```bash
npm --prefix web run typecheck && npm --prefix web run lint && npm --prefix web run test
```

`web/type-tests/brand-mixing.ts` must still pass unchanged — the combinators
must not introduce a competing brand mechanism alongside the existing branded
types in `web/lib/units.ts`.

---

## 7. Cost, stated honestly

Roughly 60 lines added to replace roughly 80 lines of guards. On line count
this is close to a wash today and only compounds as persisted keys accumulate.
The justification is the closed soundness hole in §1, not brevity.

Ousterhout gate (`docs/solutions/patterns/ovrflo-web-standard.md:171-181`,
MUST because this crosses a trust boundary): (1) yes — every persisted key
repeats the guard pattern today, across three files; (2) yes — the combinator
surface is smaller than the guards it replaces and shrinks per additional key.

---

## 8. Gate

Per `AGENTS.md`, a plan is not build-ready until the **ignorance-lens sweep**
(`docs/solutions/patterns/ignorance-lens-sweep.md`) has run and a completeness
critic has returned a diminishing-returns verdict. That has not happened for
this plan. Run it, fold results into a `### Sweep Contracts` section, and only
then implement.
