# Fix plan — 2026-07-29 web review findings (CSP artifact lifecycle, stream discovery truncation, read-failure semantics, approval gating, config validation, a11y, claim capacity, empty-state semantics)

Status: proposed. All ten findings (two review batches, 2026-07-29) were independently verified against the code before this plan was written. None are fixed yet.

Verification notes on the review itself:

- **P1 (CSP/vercel.json)** — confirmed with one nuance. The committed [web/vercel.json](../../web/vercel.json) really does contain `http://127.0.0.1:8545` / `http://localhost:42069` in `connect-src` plus 12 stale inline-script hashes, and `npm run build` mutates it twice ([build-csp.mjs:153](../../web/scripts/build-csp.mjs), [csp-hash-inline.mjs:103](../../web/scripts/csp-hash-inline.mjs)). Vercel's current docs (checked 2026-07-29) confirm `vercel.ts` exists as the supported "programmatic file-based configuration that runs at build time" and describe `vercel.json` as static configuration; the docs do **not** document whether a mid-build mutation of `vercel.json` is honored. Relying on undocumented behavior for the security header that gates hydration is the defect, independent of whether it happens to work today. Also: every local build dirties a committed file, which is how the stale localhost CSP got committed in the first place.
- **P1 (stream discovery)** — confirmed. [ponder.ts:66](../../web/lib/ponder.ts) hardcodes `limit = 100`; the `/streams` endpoint ([tools/ponder/src/api/index.ts:109](../../tools/ponder/src/api/index.ts)) orders newest-first, caps at `MAX_STREAM_LIMIT = 500`, and returns no `hasMore`/cursor/total. [useHeldStreams.ts](../../web/hooks/useHeldStreams.ts) treats the page as the complete set. Streams are per-deposit, so >100 active streams is an ordinary state, and truncation is silent.
- **P2 (zero-collapsed read failures)** — confirmed. `withdrawableAmountOf` failures become `0n` at [useHeldStreams.ts:160](../../web/hooks/useHeldStreams.ts), [useLoanBook.ts:115](../../web/hooks/useLoanBook.ts), [useBorrowerLoans.ts:76](../../web/hooks/useBorrowerLoans.ts). `useLoanBook`/`useBorrowerLoans` omit `withdrawableReads` from their returned `isLoading`/`error` entirely. [useHeldStreams.test.tsx:135](../../web/tests/hooks/useHeldStreams.test.tsx) pins the wrong behavior. This violates `docs/solutions/ui-bugs/nullish-default-flips-read-semantics.md`.
- **P2 (approval buttons)** — confirmed. Convert approvals use `disabled` instead of `modeDisabled` ([ActionModal.tsx:836, 848](../../web/components/ActionModal.tsx)); repay approval ignores `validationError` ([ActionModal.tsx:1691](../../web/components/ActionModal.tsx)); borrow stream approval ignores `recipientMatches`, quote, and gather state ([ActionModal.tsx:1259](../../web/components/ActionModal.tsx)).
- **P2 (zero factory in prod)** — confirmed. [config.ts:42](../../web/lib/config.ts) falls back to `ZERO_ADDRESS` and [config.test.ts:78](../../web/tests/lib/config.test.ts) pins it. This silently reopens the spirit of WEB-007 ("environment config assumptions can fail hard", recorded FIXED in `web/reviews/issues-and-fixes.md`).
- **P3 (unnamed stream select)** — confirmed. The `<select>` at [ActionModal.tsx:1117](../../web/components/ActionModal.tsx) has no label, `aria-label`, or `aria-labelledby`.

Batch 2 (verified 2026-07-29, same session):

- **P2 (matured-claim MAX exceeds series capacity)** — confirmed, and it is a WEB-009 regression. `ConvertForm` enables the `marketTotalDeposited` read only for `mode === "deposit"` ([ActionModal.tsx:703-709](../../web/components/ActionModal.tsx)); `claim_matured` MAX fills the full wallet ovrfloToken balance and `modeDisabled` checks only balance and maturity. The contract's `claim` requires `marketTotalDeposited[market] >= amount` ([OVRFLO.sol:437-438](../../src/OVRFLO.sol)) and `claimablePt(ptToken)` exists as a view ([OVRFLO.sol:528](../../src/OVRFLO.sol)). `web/reviews/issues-and-fixes.md` WEB-009 records the old `ClaimModal` capping MAX at `min(balance, claimablePt)`; the current form dropped it. Cross-market fungibility (a documented design feature) makes over-holding ordinary, so the revert is reachable in normal use.
- **P2 (loading/RPC failure renders "NO APPROVED MARKETS")** — confirmed. `useAllMarkets` returns `isLoading`/`error`, but [MarketsApp.tsx:47-55](../../web/components/MarketsApp.tsx) passes only `.markets`/`.tooLarge`, and [MarketsTable.tsx:64-69](../../web/components/MarketsTable.tsx) renders the empty-state row whenever `markets.length === 0`.
- **P2 (Claim All falsely completes under unavailable discovery)** — confirmed. `useHeldStreams` exposes `stale` and `unavailable`, and [PositionSummary.tsx](../../web/components/PositionSummary.tsx) references neither (grep-verified): the aggregate is built from `streams.streams` alone, so with discovery down the stream legs silently vanish from `claimAllStreams` while pool claims proceed to "ALL CLAIMS CONFIRMED". PositionList handles the same states correctly; the summary is the gap.
- **P2 (multicall subcall failures erase authoritative state)** — confirmed at all four sites. [useAllMarkets.ts](../../web/hooks/useAllMarkets.ts) treats a failed `approvedMarketCount` as `0n` (vault's markets vanish) and drops rows on failed address/series reads; [useLending.ts:27-32](../../web/hooks/useLending.ts) turns failed params into `0` / `1n` — a failed `nextLoanId`/`nextLiquidityId` collapses the entire id enumeration to empty downstream; [useLendingLiquidity.ts:34](../../web/hooks/useLendingLiquidity.ts) and [useLoanBook.ts:62-69](../../web/hooks/useLoanBook.ts) drop rows on any failed subcall. In every case the outer `error` stays `null` because the multicall itself succeeded.
- **P3 (negative amounts)** — confirmed. [parseAmount (ActionModal.tsx:340)](../../web/components/ActionModal.tsx) returns `parseUnits(raw, 18)` unchecked, which is negative for `"-1"`. Gates check `amount === 0n` and upper bounds only, so claim/wrap/unwrap/supply/repay render enabled with a negative amount (deposit is incidentally protected because its preview read requires `amount > 0n`). The uint256 ABI encoding fails at the wallet, surfacing a low-level error instead of validation.

Recommended implementation order: Task 4 (config validation) → Task 1 (CSP lifecycle) as they interact at build time; Task 10 (partial-read semantics) before Task 3 and Task 8 since they share the "unresolved ≠ zero/absent" representation; then the rest independently. Task 11 (positive-amount validation) folds naturally into Task 5's shared-precondition work.

---

## Task 1 (P1) — Stop mutating committed `vercel.json`; make the CSP a build artifact

**Files:** `web/vercel.json` (delete), new `web/vercel.ts`, `web/scripts/build-csp.mjs`, `web/scripts/csp-hash-inline.mjs`, `web/package.json`, new verification script or extension of `web/scripts/verify-static-export.mjs`, `.gitignore` if needed.

**Problem being fixed:** the deployed CSP depends on a committed file being rewritten mid-build — undocumented on Vercel, and the committed state is a localhost CSP with stale hashes that blocks production RPC/indexer traffic and Next hydration if it ever ships.

**Approach:**

1. Delete the committed `web/vercel.json`. No committed file may carry a CSP that can go stale.
2. Add `web/vercel.ts` — Vercel's supported programmatic config, evaluated at build time. It should:
   - Build `connect-src` from `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_PONDER_URL` with the same fail-loud rule as `build-csp.mjs` (missing origin throws unless `CSP_ALLOW_FALLBACKS=1`). Extract the origin/CSP-template logic from `build-csp.mjs` into a shared module (`web/scripts/csp-template.mjs` or similar) so `vercel.ts`, the `_headers` writer, and the verifier all consume one source of truth — no duplicated CSP string.
   - Handle the hash problem: `vercel.ts` runs before `next build`, so it cannot know the inline-script hashes. Two acceptable resolutions — pick one during implementation and record why:
     - **(a) Preferred if compatible with Vercel's evaluation order:** have `vercel.ts` read a hash manifest file if present. Verify empirically with `vercel build` whether `vercel.ts` is evaluated after `buildCommand`; if it is not, this option is dead.
     - **(b) Fallback, always works:** stop hashing per-build. Next's inline scripts for a static export are deterministic per build; if per-build hashes can't reach `vercel.ts`, move the exported site to Cloudflare Pages/Netlify semantics on Vercel too — i.e., serve headers from the exported `out/_headers` path via Vercel's Build Output API (`.vercel/output/config.json` written post-build by `csp-hash-inline.mjs`). The Build Output API is a documented artifact path that packages `out/` and routing headers together, exactly what the finding's fix direction asks for.
   - Whichever path is chosen, `csp-hash-inline.mjs` must stop writing to `web/vercel.json`/`vercel.ts` (source files) and only ever write build outputs (`out/_headers`, `.vercel/output/config.json`).
3. `build-csp.mjs` keeps emitting `public/_headers` (Cloudflare/Netlify path unchanged) but drops the `vercel.json` write.
4. Add a build-time verification step (run from `npm run build` after the hash step, alongside `verify-static-export.mjs`): parse the final deployed-header artifact (whichever of `.vercel/output/config.json` / `out/_headers` is authoritative for the target), extract `connect-src` and `script-src`, and assert (i) the RPC and Ponder origins match the env the bundle was built with, and (ii) every inline-script hash present in `out/**/*.html` appears in `script-src`. Fail the build on any mismatch. This is the "compare resulting CSP with exported HTML" test from the finding, per `docs/solutions/best-practices/fail-the-build-on-missing-security-config.md`.
5. Run `vercel build` locally once during implementation to confirm the headers in the produced output are the env-derived ones, and record the observed `vercel.ts`-vs-`buildCommand` ordering in a `docs/solutions/integration-issues/` writeup.

**Acceptance:**
- No build step writes inside the repo's committed file set; `git status` is clean after `npm run build`.
- A build with `NEXT_PUBLIC_RPC_URL`/`NEXT_PUBLIC_PONDER_URL` set produces deployed-header artifacts containing those origins and the fresh hashes; a build with them unset and no `CSP_ALLOW_FALLBACKS` fails.
- New verifier fails if `script-src` hashes and exported HTML diverge (test by tampering with one hash in a fixture).

## Task 2 (P1) — Paginate stream discovery; never silently truncate

**Files:** `tools/ponder/src/api/index.ts`, `web/lib/ponder.ts`, `web/hooks/useHeldStreams.ts`, consumers that render aggregate actions (PositionSummary / Claim All), `web/tests/lib/ponder.test.ts` (or wherever the limit tests live), `web/tests/hooks/useHeldStreams.test.tsx`.

**Approach:**

1. **Endpoint:** add keyset pagination to `/streams` — accept `before=<streamId>` (exclusive upper bound, works with the existing `ORDER BY streamId DESC`), and return `{ streamIds, hasMore }` where `hasMore` is computed by fetching `limit + 1` rows. Keep `MAX_STREAM_LIMIT = 500` per page. Keep the response shape backward-compatible (`streamIds` unchanged; `hasMore` additive).
2. **Client:** `fetchHeldStreamIds` loops pages (page size 100 stays fine), following `before = last id of previous page` until `hasMore` is false, with a hard safety ceiling (e.g. 50 pages / 5 000 ids). If the ceiling is hit, throw a distinct error rather than returning a silently-partial set — partial discovery must be indistinguishable from failed discovery to downstream code, because `useHeldStreams` already has correct unavailable/stale semantics for failures (R43/R44) and aggregate actions must not run over a partial set.
3. **Hook/UI:** no semantic change needed in `useHeldStreams` beyond what falls out: a completed multi-page fetch is a complete set; a mid-pagination failure rejects the query and flows into the existing `stale`/`unavailable` handling, which already renders the direct-Sablier recovery route.
4. **Tests:**
   - Endpoint: 101+ seeded rows → two pages, no overlap, `hasMore` true then false; `before` bound respected.
   - Client: mock fetch returning `hasMore: true` pages → asserts all pages concatenated in order; mid-pagination failure → rejects; ceiling reached → rejects with the distinct error.
   - Replace/extend the existing "asserts the default limit" test with the 101-results case.

**Acceptance:** a wallet with 250 active streams sees all 250 in positions, borrow selection, and Claim All; a discovery run that cannot complete surfaces the existing unavailable/recovery UI, never a shorter list.

## Task 3 (P2) — Represent failed `withdrawableAmountOf` reads as unavailable, not zero

**Files:** `web/lib/types.ts` (`HeldStream`), `web/hooks/useHeldStreams.ts`, `web/hooks/useLoanBook.ts`, `web/hooks/useBorrowerLoans.ts`, consumers (PositionSummary, PositionList, ActionModal claim/close/Claim All paths), `web/tests/hooks/useHeldStreams.test.tsx`, `web/tests/hooks/useLoanBook.test.tsx` (add), `web/tests/hooks/useBorrowerLoans.test.tsx`.

**Approach:**

1. Change the value type at all three collapse sites from `bigint` (defaulting `0n`) to `bigint | null` where `null` means "read did not resolve" (`withdrawable: null`, and in `useLoanBook`, `claimable` computed only when its inputs resolved, else `null`). Follow `docs/solutions/ui-bugs/nullish-default-flips-read-semantics.md`: unresolved state must not collapse into a valid domain value.
2. Propagate overlay state: `useLoanBook` and `useBorrowerLoans` must include `withdrawableReads.isLoading` in `isLoading` and `withdrawableReads.error` in `error` (matching how the primary reads already compose).
3. Consumers:
   - Per-position display: render a distinct "CLAIMABLE UNAVAILABLE — RETRY" state (with the existing direct-contract recovery link where one exists) instead of `0`.
   - Disable only the action that depends on the unresolved read (claim for that stream, close for that loan) — not the whole view.
   - Claim All / aggregate proceeds: exclude-and-flag is not acceptable (it understates recoverable value silently); instead, when any constituent read is unresolved, show the aggregate as incomplete and gate the aggregate action until reads resolve or the user retries.
4. Tests:
   - Flip the pinned assertion in `useHeldStreams.test.tsx:135` from `0n` to `null`.
   - Add partial-failure tests: one of N overlay reads fails → that entry is `null`, others carry values, hook-level `error` reflects it.
   - Add overlay-loading tests for `useLoanBook`/`useBorrowerLoans`: `isLoading` true while the Sablier batch is in flight.

**Acceptance:** with one Sablier read mocked to fail, the UI shows an explicit unavailable state for that position, the aggregate is marked incomplete, and no confident `0` renders anywhere for it.

## Task 4 (P2) — Fail production builds on a missing/zero factory

**Files:** `web/lib/config.ts`, `web/tests/lib/config.test.ts`, build wiring in `web/package.json` (and Task 1's shared validation step), `web/reviews/issues-and-fixes.md` (reopen/append to WEB-007).

**Approach:**

1. Introduce one explicit local-build escape hatch and reuse the one that already exists: `CSP_ALLOW_FALLBACKS=1` is the project's established "this is a local build" signal. Rename/alias it to a single build-mode flag if clearer (e.g. `BUILD_ALLOW_DEV_DEFAULTS=1`), but do not add a second parallel convention — decide during implementation and apply to both the CSP script and config.
2. In `config.ts`: when `NEXT_PUBLIC_OVRFLO_FACTORY` is unset or `ZERO_ADDRESS`, throw unless the local-build flag is set (the flag must be readable at bundle-build time; `NEXT_PUBLIC_`-prefix it if needed so the module-scope check works in the static export). Keep `parseAddress` strictness for malformed values as-is.
3. Consolidate required-production-env validation into one build-time step (extends Task 1's verifier or a small `verify-env.mjs` that runs first in `npm run build`): factory address present and non-zero, RPC and Ponder origins present — one failure message listing everything missing.
4. Tests: update `config.test.ts` — unset factory without the flag → throws; unset factory with the flag → `ZERO_ADDRESS`; valid address unchanged. Do **not** touch the zero Reown project ID fallback (intentionally documented in `docs/solutions/ui-bugs/web-markets-ui-polish.md`).
5. Update the WEB-007 record: note the regression window and the restored behavior.

**Acceptance:** `npm run build` with production-style env but no factory fails with a clear message; local bootstrap flows (`bootstrap:local` etc., which set the flag or the env) still build.

## Task 5 (P2) — Approval buttons inherit action-validity preconditions

**Files:** `web/components/ActionModal.tsx`, `web/lib` form-logic helpers if extracted (`convertApprovalNeeds` siblings), `web/tests/components/ActionModal.*.test.tsx`.

**Approach:** for each form, derive a shared `preconditionsFailed` value = every condition that invalidates the final action **except** those that depend on approval itself or on transaction phase, and add it to the approval buttons' `disabled`:

1. **Convert (lines ~833–859):** approval buttons get `disabled || Boolean(validationError) || (mode === "deposit" && (!depositPreview || matured || !capLoaded || capReached)) || (mode === "unwrap" && wrapCapacity < amount)` — i.e. exactly `modeDisabled`. Simplest correct change: use `modeDisabled` on both approval buttons.
2. **Repay (line ~1691):** add `Boolean(validationError) || repayAmount === 0n || !loan` to the approval button's `disabled`.
3. **Borrow stream approval (line ~1259):** add `!recipientMatches || !quoteData || minAcceptable === null || gatherIds.length === 0 || target === 0n || fill === 0n` (mirror the final borrow gate at ~1090 minus approval/tx-phase members).
4. Prefer expressing each as one named derivation next to the existing final-action gate (e.g. reuse `modeDisabled`, and factor the borrow gate into a shared expression used by both buttons) so the two can't drift again.
5. Tests: for each existing insufficient-balance / cap-reached / recipient-mismatch / gather-failure test that currently asserts the message and final button, add an assertion that the approval button is also disabled. Add one loading-state case (cap/preview unresolved → deposit approval disabled).

**Acceptance:** no approval button is clickable in any state where the UI already knows the final action cannot proceed; approval remains clickable when the only blocker is the missing approval.

## Task 6 (P3) — Accessible name for the borrow stream selector

**Files:** `web/components/ActionModal.tsx` (~1117), component test file.

**Approach:**

1. Give the `<select>` a stable `id` (e.g. `borrow-stream`), add a visible `<label htmlFor="borrow-stream" className="label mono">STREAM</label>` above it — matching the `STREAM {id}` label already rendered in the fixed-stream branch and the `AmountInput` label pattern.
2. Add a component-level test asserting `getByLabelText(/STREAM/)` (or `getByRole("combobox", { name: /STREAM/ })`) resolves to the select — required because the base-page axe sweep never opens this modal.

**Acceptance:** the select has an accessible name; test fails if the association is removed.

## Task 7 (P2) — Cap matured-claim MAX and validation at the series' redeemable PT (WEB-009 restoration)

**Files:** `web/components/ActionModal.tsx` (ConvertForm), `web/tests/components/ActionModal.convert.test.tsx` (or equivalent), `web/reviews/issues-and-fixes.md` (reopen/append to WEB-009).

**Approach:**

1. In `ConvertForm`, add reads enabled for `mode === "claim_matured"`: `claimablePt(market.ptToken)` and reuse the existing `marketTotalDeposited(market.market)` read (widen its `enabled` from deposit-only to `mode === "deposit" || mode === "claim_matured"`). Note `claim` burns against `marketTotalDeposited` while PT actually leaves the vault balance `claimablePt` reflects — bound by both.
2. Derive `claimCapacity = min(claimablePt, marketTotalDeposited)`, treating either unresolved read per Task 10's rule (unresolved ≠ 0): while unresolved, `modeDisabled` for claim mode and MAX disabled — never a silent zero cap.
3. MAX for claim mode fills `min(walletBalance, claimCapacity)`. `convertValidationError` (or a claim-specific extension) rejects `amount > claimCapacity` with a distinct message (e.g. `EXCEEDS SERIES REDEEMABLE PT`), and the form shows the series' available PT alongside the wallet balance.
4. Because Task 5 makes approvals inherit validity, no separate approval change is needed here — claim mode has no approval step anyway (burn path).
5. Tests: MAX with wallet balance > capacity → fills capacity; manual amount above capacity → validation error and disabled submit; capacity reads unresolved → submit disabled, no zero shown. Update the WEB-009 record with the regression window (former `ClaimModal` → current `ConvertForm`).

**Acceptance:** no claim transaction can be armed that the contract's `require(currentDeposited >= amount)` would predictably revert; the series' redeemable PT is visible in the form.

## Task 8 (P2) — Distinguish loading/error from "no approved markets"

**Files:** `web/components/MarketsApp.tsx`, `web/components/MarketsTable.tsx`, component tests.

**Approach:**

1. Pass a status into `MarketsTable`: `status: "loading" | "error" | "ready"` derived from `useAllMarkets().isLoading` / `.error` (already returned, currently discarded at [MarketsApp.tsx:47](../../web/components/MarketsApp.tsx)).
2. `MarketsTable` renders three distinct empty-table rows: `LOADING` while loading; on error, `MARKETS UNAVAILABLE — <userFacingError>` with a retry affordance (refetch) and the direct-contract guidance pattern used elsewhere; `NO APPROVED MARKETS` only when a settled, successful read returned zero markets.
3. Follow the existing `positionlist-blanket-error-hides-onchain-positions.md` precedent: an error with previously-loaded markets should keep rendering them (wagmi keeps `data` on refetch failure) rather than blanking the table — only the no-data-at-all case gets the error row.
4. Tests: loading → LOADING row; error with no data → unavailable row, not NO APPROVED MARKETS; error with cached data → table still renders rows; settled empty → NO APPROVED MARKETS.

**Acceptance:** during an RPC outage the UI says the markets read failed; "NO APPROVED MARKETS" appears only after a successful read.

## Task 9 (P2) — Claim All must not claim completeness over an incomplete portfolio

**Files:** `web/components/PositionSummary.tsx` (and its ClaimAll flow component), tests.

**Approach:**

1. Consume `streams.stale` and `streams.unavailable` in `PositionSummary` (currently ignored).
2. `unavailable`: render the documented direct-Sablier recovery notice in the STREAMS cell (same content PositionList already renders), include "stream discovery unavailable" next to the claimable total, and change the aggregate action so it cannot present itself as complete: either disable CLAIM ALL, or relabel it `CLAIM POOL SHARES` and suppress the "ALL CLAIMS CONFIRMED" terminal copy in favor of "POOL CLAIMS CONFIRMED — STREAMS NOT DISCOVERED". Pick one during implementation; the invariant is that no state can read as "everything claimed" while stream discovery failed. Also fix `hasPositions`: a stream-only portfolio must not disappear — when `unavailable`, the summary strip renders with the recovery notice rather than unmounting.
3. `stale`: keep actions enabled per R43 (contracts validate at submission), but label the stream figures and the Claim All confirmation as operating on a known-as-of set (e.g. `STREAMS AS OF <relative time> — INDEXER UNREACHABLE`), reusing the existing stale-warning styling.
4. This composes with Task 3 (unresolved per-stream withdrawable gates the aggregate) and Task 2 (partial pagination now rejects, flowing into `unavailable`): after all three, Claim All runs only over a set that is complete, resolved, and either fresh or explicitly labeled stale.
5. Tests: unavailable + claimable pools → aggregate cannot terminate in unqualified success copy, recovery notice rendered, stream-only portfolio still shows the strip; stale → labels present, actions enabled.

**Acceptance:** with discovery down, a user with streams sees a recovery route and never an "ALL CLAIMS CONFIRMED" over pool-only claims.

## Task 10 (P2) — Multicall subcall failures must surface, not default

**Files:** `web/hooks/useAllMarkets.ts`, `web/hooks/useOvrflos.ts` (same pattern upstream), `web/hooks/useLending.ts`, `web/hooks/useLendingLiquidity.ts`, `web/hooks/useLoanBook.ts`, `web/hooks/useBorrowerLoans.ts`, consumers, tests (including the ones pinning "failed APR becomes zero" and "failed liquidity read is dropped").

This is the general form of Task 3; implement them together. Rule (per `nullish-default-flips-read-semantics.md`): a failed subcall may drop or default **nothing** silently — it either fails the dependent unit closed with a visible incomplete flag, or renders an explicit unavailable state.

**Approach, per hook:**

1. **`useLending`:** the params are required configuration. Replace per-field defaults with a settled/failed discriminant: return `params` only when all six reads succeeded; otherwise `params: null` (or `status: "error"`), and include subcall failure in the returned `error` (synthesize one when the multicall succeeded but a subcall failed). Downstream hooks (`useLendingLiquidity`, `useLoanBook`, `useBorrowerLoans`, `SupplyForm`, borrow rate math) treat null params as loading/error, never as `nextId = 1n` / `apr = 0`. This kills the worst case: a failed `nextLoanId` silently rendering an empty loan book.
2. **`useAllMarkets` / `useOvrflos`:** keep successful siblings (one vault's failure must not blank the table — R33 spirit), but count failures: return `incomplete: boolean` (any failed count/address/series subcall) and surface it in `MarketsTable` as a partial-data warning row/notice (reuse the truncation-notice component pattern). A failed `approvedMarketCount` marks incomplete rather than silently contributing zero markets.
3. **`useLendingLiquidity`:** keep successful rows, add `incomplete` when any subcall failed. The borrow rate ladder and gather logic must show the partial-data warning when incomplete — a false-empty ladder misprices borrows.
4. **`useLoanBook` / `useBorrowerLoans`:** a failed subcall for an id currently drops the row (hiding a position) — return `incomplete` and have PositionSummary/PositionList render the partial-data warning; per-row unresolved withdrawable is already Task 3.
5. Tests: flip the pinned wrong-behavior tests; add per-hook cases: one failed subcall → siblings survive, `incomplete`/error surfaced, no default value leaks; `useLending` with one failed param → dependent hooks report loading/error, not empty data.

**Acceptance:** no code path converts a failed read into `0`, `1n`, or a silently absent row; every consumer of partial data shows it as partial.

## Task 11 (P3) — Reject non-positive amounts at parse time

**Files:** `web/components/ActionModal.tsx` (`parseAmount` and every gate using it), tests.

**Approach:**

1. Change `parseAmount` to clamp invalid results: return `0n` for negative parses (making `-1` indistinguishable from empty at the gate level), **and** additionally surface an explicit error for visibly-invalid input: return `{ amount: bigint; invalid: boolean }` (or keep the bigint return and add a sibling `amountInputError(raw)` helper) so forms can render `AMOUNT MUST BE POSITIVE` for negative/malformed non-empty input instead of a silently disabled button.
2. Wire the shared error into each form's `validationError` chain (composes with Task 5 so approvals inherit it). Since every gate already treats `0n` as disabled, the clamp alone fixes the armed-write bug; the message fixes the UX.
3. Tests: paste `-1`, `-0.5`, `1e5`, `abc` into supply/claim/wrap/unwrap/repay inputs → action and approval disabled, positive-amount error shown for the negative cases; `0`/empty keeps the current quiet disabled state.

**Acceptance:** no form can arm a write with `amount <= 0n`, and negative input produces an input-validation message rather than a wallet encoding failure.

---

## Verification (after all tasks)

1. `npm --prefix web run lint:security`
2. `npm --prefix web run test`
3. `npm --prefix web run build` twice: once production-style (all env set) asserting a clean `git status` afterward, once with missing env asserting it fails.
4. `vercel build` (Task 1) — inspect output headers.
5. E2E per `docs/agents/testing.md` if the seeded fork is available.
6. Afterward: `/ce-compound` writeups for the vercel.json artifact-lifecycle lesson and the WEB-007/WEB-009 regressions (two independently "FIXED" records silently reopened by a rewrite — worth one writeup on carrying `web/reviews/issues-and-fixes.md` assertions into tests that survive component rewrites).
