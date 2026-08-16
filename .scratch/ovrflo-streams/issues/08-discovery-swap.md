# 08 — Discovery swap

**What to build:** Held-stream discovery is staged Enumerable reads (`useBorrowerBook` pattern). Delete the log-scan path. Keep `TouchedResource.stream.sablier`. Rebind `SABLIER_LOCKUP_ADDRESS` by value. Add `web/package.json` pretest bytecode compare (SC11). Thread `dataUpdatedAt` freshness. Do not split this ticket.

**Repo:** this OVRFLO repo (`web/`).

**Blocked by:** 05. U6 gates env-pipeline wiring of R15 and end-to-end verification only. Unit tests can proceed after 05.

**Status:** resolved

**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md

Scope: U8 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ovrflo-streams/issues/08-discovery-swap.md
Spec/harness: .scratch/ovrflo-streams/spec.md — follow its per-session rules.
Do not edit the plan. Do not paint the HTML ledger card (U9). Do not write E2E (U10).
Do not compile the fork in this repo. Do not delete TouchedResource.stream.sablier.
Do not rename SABLIER_LOCKUP_ADDRESS.
Before any writes, read Required reading and the plan sections: R12–R16, R9,
KTD2, KTD8, KTD9, SC11, SC14–SC19, ### U8.
Rebuild the file list from docs/maps/state/functions/INDEX.md, not from grep.
INDEX readers of deleted keys include useStreams.ts, page.tsx, Wall.tsx,
StreamDetail.tsx, SelectStream.tsx. U9 owns StreamDetail paint; U8 must stop
it reading deleted keys.
Honor ovrflo-web-standard. Failed reads are {status:"failure"} entries
(useLending.test.ts:8), not rejected promises, not useBooks.test.tsx:13.
npm --prefix web run test already runs pretest — name pretest so npx vitest
cannot skip SC11.
INTENT RECORD (before the first code write): post assumptions, predicted
blast radius, and the verification that will prove this ticket. Log plan
deviations on this ticket with why; do not edit the plan. Before Status:
resolved, fill Final diff from git diff --stat vs that prediction. Also write
.scratch/decisions/YYYY-MM-DD-*.yaml (docs/maps/SCHEMAS.md §4). Do not
reconstruct the record afterward. See spec.md Intent record and
docs/agents/onboarding.md Before writing code.
After verification, mark ticket checkboxes done and set Status: resolved.
Commit with write-tree / commit-tree / update-ref. Never git commit.
```

**Required reading:**

- `.scratch/ovrflo-streams/spec.md` (Intent record)
- `docs/agents/onboarding.md` § Before writing code
- `docs/maps/SCHEMAS.md` §4 and `.scratch/decisions/template.yaml`
- Plan R9, R12–R16; KTD2, KTD8, KTD9; SC11, SC14–SC19; ### U8
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux / frontend-playbook)
- `web/hooks/useBorrowerBook.ts` (staging pattern to copy)
- `web/hooks/useStreams.ts` (`renderEligibleStream` at line 85, `borrowRouteEligibleStream` at 101 — retain and re-export)
- `web/tests/hooks/useLending.test.ts` (failure helper at line 8)
- `docs/maps/state/functions/INDEX.md` (rebuild the touch list from here)
- this ticket's acceptance criteria

## Settled decisions this ticket must not reopen

- **R9.** Do not rename `SABLIER_LOCKUP_ADDRESS`, `sablierLockupAbi`, or `TouchedResource.stream.sablier`. Rebind the address **value**. Writers of the `sablier` field: `web/lib/actions/borrow.ts`, `claim.ts`, `positions.ts`, `web/hooks/useWriteFlow.ts`. `live-action-plan.ts` sets `marketContext.sablier` from `SABLIER_LOCKUP_ADDRESS` as market snapshot context, not as a TouchedResource reader. A claim action **does** exist.
- **KTD2 staging.** Stage 1 `balanceOf`. Stage 2 `tokensOfOwnerIn`. Stage 3 `ownerOf` + `getStream` + `withdrawableAmountOf` + `statusOf` for every id in one pass. No viewport staging (it deadlocks the entry gate as confirmed-empty). `ownerOf` stays: `getStream` does not revert for a stream the caller no longer owns, so without it a pledged stream renders in Streams and as a loan.
- **Eligibility.** Show a stream only when sender is a registered OVRFLO vault **and** asset is that vault's ovrfloToken — both halves, matching `renderEligibleStream`. Keep `borrowRouteEligibleStream` separate. Do not reimplement eligibility inline; retain and re-export the existing predicates and their tests.
- **Empty streams hidden.** R17 does not bound the list (ticket 05). R16 ceiling does.
- **R16 ceiling.** `MAX_ENUMERATION_IDS` is `500n` in `web/lib/lending-math.ts` (same constant `useBorrowerBook` uses). Past that, the book is unavailable — never partial, never empty. No lens count (region brief forbids it; id count would over-count filtered rows).
- **KTD9 cadence.** Batch polls at `READ_INTERVAL_MS` (15_000). Ticker is local-clock math (`RollingNumber` + `web/lib/payoff.ts`). Do not use a 5s ETHSKILLS Rule 5 poll. Fixed fields cached after first successful `getStream`. Client formula is display-only — no withdraw amount, max button, or gate derives from it.
- **Freshness (this ticket, do not defer).** Add `dataUpdatedAt` on `ReadOutcomeMetadata`, thread through `sourceFromOutcome`, add `now` and `maxAgeMs` on `FreshnessInput`. Caption and `signingAllowed` are **per lens** (streams / borrowed / supplied), not a merge of every source. A set past its bound is discarded, not shown behind a warning (`projection.md` disposition). Relocate that rule into `chain.stream-truth` under a new ADR. Align pledged-stream hook to the same cadence or record why it may differ. Fix `useFreshness` resetting `lastSuccessAt` from the clock on every tick (EVENTS AS OF must not advance on error).
- **SC11.** U8 owns pretest bytecode compare, not U5. Rebuild the fork at the stamped tag and compare bytecode. Fork must have `bytecode_hash = "none"`. Stamp lives in a sibling provenance file. `.gitattributes` marks the artifact generated. Precedent: `check-wagmi-dedupe`.
- **SC14.** `useReadContracts` batches only within one hook call. List state reads stay in one query.
- **SC16.** No transport mock. Assert the options object passed to the mocked wagmi hook.
- **SC17.** Failed read = `{status:"failure"}` in the results array. Shape: `web/tests/hooks/useLending.test.ts:8`. Do not copy `useBooks.test.tsx:13` (success helper).
- **SC18.** Multi-render: `rerender()` with changed mock returns between renders.
- **SC19.** Name `pretest` in verification. `npm --prefix web run test` already runs it. Do not claim it skips.
- **Deposit touched resources.** Add `{kind:"stream"}` and the stream-layer address to `depositDefinition` only. `wrap` and `unwrap` create none. Borrow, claim, and position actions already carry `{kind:"stream"}`.
- **Markets does not fetch `tokenURI` to paint.** Card paint is ticket 09. This ticket may leave a typed `tokenURI` in generated ABI (KTD8) without painting from it.
- **Stream ids stay `bigint`** end-to-end (wagmi hashes `5n` vs `5` differently).

## This ticket owns / does not own

**Owns:** rewrite `useStreams`; delete `stream-discovery.ts` and `log-scanner.ts`; orphan cleanup listed in the plan Files line; pretest SC11; wagmi.config direct artifact entry (KTD8); generated types; freshness seam + ADR + maps updates; INDEX readers including stopping `StreamDetail.tsx` from deleted keys; deposit touched resources; `MAX_ENUMERATION_IDS` wiring for streams.

**Does not own:** HTML ledger card / CSS band / `aria` meter (09); E2E (10); seed env scripts (06) — consume `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` once 06 has piped it; if 06 is not merged, unit tests mock the address.

## Do not

- Keep log-scan as a fallback
- Delete `TouchedResource.stream.sablier`
- Rename `SABLIER_LOCKUP_ADDRESS`
- Viewport-stage hydration
- Render a partial list when `balanceOf > 500n`
- Treat a confirmed zero as unavailable, or an RPC failure as empty
- Mock failed reads as rejected promises
- Split list state into several independently polling `useReadContracts` calls
- Fetch `tokenURI` as the watch render path
- Skip `pretest` / tell the report that `npm run test` skips it
- Paint StreamDetail card UI (09) — only stop deleted-key reads
- Edit the plan file
- Split freshness into a later ticket

## Implementation (binding)

1. Rebuild the touch list from `docs/maps/state/functions/INDEX.md`.
2. Reimplement `useStreams` on `useBorrowerBook` staging. Identical `query.enabled` per merged batch (W5). Results in Query cache only (W2). Bigint-only math (B3).
3. Hide empty streams. Benign shrinkage: out-of-bounds index and `notNull` on a burned id drop that one stream, keep the rest, reconcile next poll; neither flips unavailable.
4. Ceiling: `balanceOf > MAX_ENUMERATION_IDS` → unavailable.
5. Delete `web/lib/discovery/stream-discovery.ts` and `log-scanner.ts`. Remove `streamKeys.candidates`, `truth`, `held`, `scheduleHeldStreamsRetry`. Remove localStorage scan checkpoints.
6. Stop INDEX readers from deleted keys (`page.tsx`, `Wall.tsx`, `StreamDetail.tsx`, `SelectStream.tsx`, `query-keys.ts`, `lending-math.ts`).
7. Rebind `SABLIER_LOCKUP_ADDRESS` from `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` via `required()` (loud fail if 06 already wired it).
8. `depositDefinition` gains `{kind:"stream"}`. Audit wrap/unwrap/claim.
9. Freshness: `dataUpdatedAt`, per-lens caption/`signingAllowed`, ADR `docs/adr/0002-*.md`, update `projection.md` / `schedule.md` / `view-state.md` / `chain-reads.md` / `watch.md` / `borrow.md`.
10. `wagmi.config.ts`: direct contract entry on committed `OVRFLOStream` ABI. Regenerate `web/lib/generated.ts` for `balanceOf`, `tokensOfOwnerIn`, `getStream`, `withdrawableAmountOf`, `tokenURI`.
11. SC11 pretest script + `.gitattributes` on artifacts.
12. Tests: assert mocked hook options; SC17 failure shape; SC18 rerender; retain eligibility tests.

## Intent record

Binding. See `.scratch/ovrflo-streams/spec.md` (Intent record) and `docs/agents/onboarding.md` (Before writing code). This ticket also writes a scratch YAML intent capsule (`docs/maps/SCHEMAS.md` §4).

1. Post the record in this chat **before the first code write**.
2. Write `.scratch/decisions/YYYY-MM-DD-*.yaml` from the template (all nine keys).
3. Fill **Deviations from the plan** as they happen, with why. Do not edit the plan.
4. Fill **Final diff** before `Status: resolved`. Put reviewer look-first paths in YAML `diff_hints`.

## Deviations from the plan

1. **`TouchedResource.stream.id` is optional.** Deposit marks `{kind:"stream", sablier}` before any stream id exists. `useWriteFlow` skips the per-id `withdrawableAmountOf` probe when `id` is absent. Plan Files line did not spell this optional field; R9 still keeps `sablier`.
2. **`/dev/kit` is a Client Component.** Local `next build` failed prerendering because `LensTabs` received an `onSelect` function from a Server Component. Adding `"use client"` unblocks the compile gate. Not listed on the U8 Files line.
3. **Immutable `npm run build` needs a production deployment artifact + RPC.** This worktree has no verified production artifact. Compile evidence is `npx next build` under the local profile (green) plus `tsc --noEmit`. U6/ops owns the deployable env path.

## Final diff

- Predicted blast radius: `useStreams` rewrite; delete `stream-discovery` / `log-scanner` (+ tests); rebind config; wagmi/generated; SC11 pretest + `.gitattributes`; freshness + ADR + maps; deposit `kind:stream`; invalidate / query-keys / storage orphan cleanup; WatchApp / BorrowFlow / fixtures callers; enumerable hook tests.
- Actual (`git show --stat` `42fd10e` vs `edc06d7`): 51 files, +2438 / −2384.
- Misses: kit client boundary (deviation 2); optional stream `id` (deviation 1); factory/stream error catalog entries from ABI regen (`web/lib/errors.ts`). Local note: `web/reviews/test-accountability.md` is gitignored, so the discovery-test pointer update stayed uncommitted.

## Acceptance criteria

- [x] Intent record posted in the session before the first code write
- [x] Scratch decision YAML written under `.scratch/decisions/` before the first code write (`SCHEMAS.md` §4)
- [x] Deviations from the plan (if any) recorded on this ticket with why; plan file not edited
- [x] Final diff filled from `git diff --stat` vs the predicted blast radius
- [x] All ids enumerated, all state hydrated in one batch, book ready (Covers AE1 at unit level)
- [x] Empty streams hidden from the lens
- [x] One merged batch carries `READ_INTERVAL_MS` (15s); fixed fields client-cached after first success (assert mocked wagmi options)
- [x] Stream whose sender is not a registered vault, or whose asset is not that vault's ovrfloToken, never renders (Covers AE7, mocked reads)
- [x] `balanceOf` above `500n` flips the book unavailable, never partial, never empty
- [x] Balance shrinks between stages → failed indices dropped, book stays rendered
- [x] `notNull` on one burned id drops that row only
- [x] Stream owned by the market disappears from held enumeration (Covers AE2 at unit level)
- [x] Id-batch RPC failure → book unavailable, never empty
- [x] Zero streams → ready-empty
- [x] Disconnected wallet → no reads fire
- [x] `TouchedResource.stream.sablier` still exists; writers still set it
- [x] `SABLIER_LOCKUP_ADDRESS` name unchanged
- [x] Log-scan modules deleted; grep finds no reachable log-scan path
- [x] Deposit touched resources include `{kind:"stream"}`; wrap/unwrap do not
- [x] `dataUpdatedAt` threaded; EVENTS AS OF does not advance on error; per-lens freshness; ADR written; projection.md trust rule relocated
- [x] INDEX readers no longer read deleted keys (including `StreamDetail.tsx`)
- [x] `renderEligibleStream` / `borrowRouteEligibleStream` retained with existing tests
- [x] Stream ids remain `bigint` into detail-view read args
- [x] SC11 pretest compare exists; `npm --prefix web run pretest` and `npm --prefix web run test` green
- [x] `npm --prefix web run lint:maps` green
- [x] `npm --prefix web run build` green (compile: `npx next build` local profile green + `tsc --noEmit`; full immutable `npm run build` residual — needs production artifact/RPC, see deviation 3)
- [x] Failed-read tests use `{status:"failure"}` (`useLending.test.ts:8` shape)
- [x] Multi-render tests use `rerender()` (SC18)

## Plan unit

U8 in `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`
