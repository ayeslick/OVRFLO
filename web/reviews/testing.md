# OVRFLO Web Testing Catalog

This is the authoritative test catalog for `web/`. It says what exists, what each
area is for, and what role it plays in the larger quality story — so an agent can
tell whether a change is covered before it edits anything.

It is **area-keyed, not file-keyed.** Tests get renamed, split, and re-homed; the
behavior they guard does not. A catalog that lists individual filenames as its unit
of truth goes stale on the first refactor and then quietly lies — which is exactly
what happened to the version of this file that preceded 2026-08-03.

Related: `web/reviews/test-accountability.md` (why coverage changed),
`web/reviews/issues-and-fixes.md` (the WEB-00x findings), `docs/maps/REVIEW.md`
(who reviews a change), `docs/maps/SCHEMAS.md` (control IDs, trust domains).

---

## Policy

1. Security-critical behavior must be covered by a test. "Security-critical" here
   means anything that gates an action, spends funds, or presents a chain fact.
2. Coverage is keyed to **behavior**, not to a component or filename. A rewrite that
   preserves behavior keeps its coverage; a rewrite that drops behavior drops
   coverage, and that is an accountability event.
3. Tests are quality gates and are not removed, skipped, or weakened casually.
4. **Deleting, rewriting, or weakening a test requires an entry in
   `test-accountability.md`** stating the reason and where the behavior is covered
   now. Adding tests, or changing tests to follow a rename with assertions intact,
   does not.
5. **An agent review approves that entry.** Review runs through the skills named in
   `docs/maps/REVIEW.md` — `ce-code-review` for test/code changes. The Owner is not a
   required reviewer for test changes and must not be inserted as one; the five
   escalation triggers in `REVIEW.md` are the whole of the Owner's surface here.
6. **Gherkin stays flow-level.** One scenario per flow, not one per control.
   Control-ID tags (`@UI-MARKETS-TABLE-BORROW`, format in `SCHEMAS.md` §1) are
   **optional at pass 1** — add them where they are cheap and obviously right. Bulk
   1:1 tagging of the existing suite is explicitly not required and is deferred.
7. This catalog is refreshed by running the commands in *Refreshing this catalog*
   below, not by editing the numbers to match an assumption.

---

## Current status

**Inventory taken 2026-08-03** (branch `feat/ai-maps-system-fill`). Every number
below came from the commands in *Refreshing this catalog*; none were carried forward
from a previous revision.

| Suite | Runner | Files | Cases |
|---|---|---|---|
| Unit + component (`web/tests/**`) | `npm --prefix web run test` (vitest) | 66 | 714 |
| E2E Gherkin (`web/tests/e2e/*.feature`) | `npm --prefix web run test:e2e` (playwright-bdd) | 6 | 31 scenarios (32 executable — one Outline has 2 examples) |
| Live frozen-block parity (`web/tests-live/`) | `npx vitest run --config vitest.parity.config.ts` | 2 | not in the default run — needs a seeded local Anvil fork |
| Type boundary (`web/type-tests/`) | `npm --prefix web run typecheck` | 1 | compile-time only |

Unit + component result on 2026-08-03: **713 passed, 1 failed.**

> **Known red — `tests/components/markets-table.test.tsx`**, scenario `expanded
> content states (R7/R8/R27) › disconnected: no balances, all mode buttons disabled
> with CONNECT WALLET`. Fails at the `DEPOSIT PT` button lookup: the disconnected
> expanded row renders `SUPPLY` and `BORROW` but no `DEPOSIT PT` control. Reproduces
> deterministically on a clean tree. Either the disconnected-state expectation or the
> component drifted — **not diagnosed here**, and not fixed here: this catalog pass
> does not own test or component edits. Whoever picks it up owes an
> accountability entry if the assertion is the thing that changes.

The e2e suite requires a seeded local Anvil fork; see `web/tests/e2e/README.md` and
`docs/agents/testing.md` before concluding a failure is a regression rather than an
environment collision.

---

## Catalog by area

Each area states what it guards and why that matters to the system as a whole.
Counts are cases, not files, as of 2026-08-03. The eight vitest areas below
partition the suite exactly — every one of the 66 files sits in exactly one area, and
the area counts sum to 714. File references drop the `.test.ts` / `.test.tsx` suffix;
the `find` command in *Refreshing this catalog* prints exact paths.

### Transaction execution and finality — 71 cases

`tests/hooks/useTransactionExecutor` · `useWriteFlow` · `useTxQueue` ·
`useApprovalWriteFlows` · `useZeroFirstApprove` · `tests/lib/action-runtime` ·
`tests/lib/modal-logic`

**Guards:** simulate-then-submit identity, success only on a confirmed receipt,
mined-revert classification, runtime chain enforcement, zero-first approval and its
stale-attempt regression, queue advance across account changes, refresh-only recovery.

**Role:** this is the money boundary. Everything else can be wrong and cost a user a
confusing screen; a defect here costs them a transaction. The rule these tests exist
to hold is that the UI never claims success before the chain confirms it, and never
submits calldata other than what the user reviewed.

### Action planning and validation — 176 cases

`tests/lib/actions` · `live-action-plan` · `claim-all` · `claim-all-execution` ·
`borrow` · `convert` · `positions` · `lending-math` · `router`

**Guards:** the pure planning layer for all twelve action types — amount validity
before authorization planning, frozen-review revalidation when calldata changes,
matured claim capacity, slippage/`minToUser` bigint math, bounded and strictly
increasing route selection, obligation and ladder math.

**Role:** planning is pure and therefore cheaply and exhaustively testable, so
correctness is pushed down here rather than defended at the React layer. The
freeze-what-you-show / recompute-what-you-submit contract lives here.

### Discovery and projection trust — 96 cases

`tests/lib/discovery/*` (`live-projection`, `lending-projection`, `log-scanner`,
`stream-discovery`, `shadow-adapters`, `live-cutover`) · `tests/lib/demand` ·
`tests/hooks/useHeldStreams` · `useLendingLiquidity` · `useLoanBook` ·
`useProjectionSync` · `useStaleRecovery`

**Guards:** browser-side log projection stays a **candidate set** and never becomes an
authority; head snapshots and reorg/freshness handling; the deleted indexer stack
stays deleted across every source tree.

**Role:** the single most expensive class of bug this app can ship is a projection
value treated as chain truth (`SCHEMAS.md` §2;
`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).
These tests are the standing proof that discovery narrows what to *ask about* and
never decides what is *allowed*.

### State honesty and read outcomes — 63 cases

`tests/lib/read-outcome` · `errors` · `invalidate` · `query-keys` ·
`query-resource-registry` · `rpc` · `tests/components/data-layer`

**Guards:** loading, stale, unavailable, failed, and empty stay five distinguishable
things; a read failure never renders as a confident zero; scoped invalidation after a
write; ordered transports and RPC failure classification.

**Role:** direct enforcement of `PRODUCT.md` principle 5 and the `States` field in
`SCHEMAS.md` §1. A collapsed failure state is the recurring trust bug in this app, and
this is where it is caught.

### Markets UI regions — 200 cases

`tests/components/ActionModal` · `markets-table` · `position-cards` ·
`position-summary` · `borrow-form` · `supply-form` · `claim-all-modal` ·
`claim-all-preflight` · `deposit-cap` · `ladder-keyboard` · `copy-value` ·
`launch-scope` · `tests/hooks/useAllMarkets` · `useLending` · `useClaimAllPreflight` ·
`useOvrflos`

**Guards:** row expansion and expanded-state matrices, wrong-network gating,
post-confirm re-arm, per-source error isolation, rate-ladder keyboard model, deposit
cap edges, terminology consistency, real per-market symbols.

**Role:** the executable half of the region briefs in `docs/maps/ui/`. When a brief
says a control is visible only under condition X, this layer is where that claim is
either held or exposed as drift.

### Accessibility and error containment — 23 cases

`tests/hooks/useFocusTrap` (`.ts` + `.tsx`) · `tests/components/modal-error-boundary` ·
`market-detail-error-boundary` · `app-error-boundaries`

**Guards:** focus trapping and Escape in overlays; a thrown component contains itself
instead of blanking the app; static-export error boundaries exist and render.

**Role:** keeps a single bad render from destroying the whole session, and keeps modal
flows operable without a mouse.

### Configuration, packaging, and mechanical bans — 70 cases

`tests/lib/config` · `deployment` · `wagmi-config` · `abis` · `browser-runtime` ·
`performance-contract` · `tests/scripts/banned-patterns` · `deployment-artifact` ·
`security-packaging`

**Guards:** production fails closed on a zero factory, missing RPC, or a placeholder
Reown ID; chain-ID enforcement; ABI drift; CSP generation and immutable artifact
packaging; **banned-pattern exemptions are exact-path only**; the prerender guard on
browser-only discovery.

**Role:** the cheap, dumb, fast gate. Anything enforceable by a string match or a
build step belongs here rather than in prose or in a reviewer's memory
(`docs/maps/REVIEW.md`, *Mechanical gates*).

### Formatting and presentation — 15 cases

`tests/lib/format`

**Guards:** token amounts formatted against the token's own decimals, APR/bps
rendering, address and maturity formatting.

**Role:** the decimals lesson from WEB-002 in permanent form — no hardcoded `18` on a
display or tx-critical path.

### E2E flows (Gherkin) — 6 features, 31 scenarios

`tests/e2e/supply.feature` · `borrow.feature` · `repay-close.feature` ·
`adjust-rate.feature` · `claim-all.feature` · `deposit-wrap-unwrap.feature`

**Guards:** each feature carries happy path, error states, and cross-cutting
scenarios (maturity captions, focus trap, responsive widths, empty categories) against
a seeded local Anvil fork with a mock wallet.

**Role:** the only layer that exercises a real chain hop end to end — discovery,
signing, receipt, and re-sync — which is precisely what a component test cannot fake.
Authority order puts Gherkin below the region briefs and above the comps: a scenario
describes a **flow**, and the brief still owns the meaning of each control it touches.

**Tagging status: no control-ID tags present as of 2026-08-03.** That is compliant
with pass-1 policy. Add a tag when you touch a scenario and the control ID is obvious;
do not open a bulk tagging pass.

### Live frozen-block parity — 2 files, out-of-band

`tests-live/parity-freeze.test.ts` · `tests-live/reorg-freshness.test.ts`

**Guards:** routes are bounded by `MAX_ROUTE_IDS`, strictly increasing, hydrated at the
frozen block, and cover the target; freshness behavior under reorg.

**Role:** deliberately excluded from `vitest run` because it needs real chain state.
Run it when discovery, routing, or freshness logic changes — a green unit suite does
not clear those.

### Type boundary — 1 file, compile-time

`type-tests/mainnet-write-boundary.ts`

**Guards:** the mainnet write boundary holds at the type level; `any` cannot be
smuggled into the config/write path.

**Role:** the WEB-004 lesson enforced by the compiler instead of by review attention.

---

## Historical issue mapping (WEB-001 … WEB-010)

`issues-and-fixes.md` records ten findings. Every filename the previous revision of
this catalog cited for them has since been deleted or renamed, so the mapping below
points at **areas**, which survive refactors.

| Issue | Where the behavior is guarded now |
|---|---|
| WEB-001 — dynamic hook usage | Markets UI regions (`useAllMarkets`) + `lib/performance-contract` |
| WEB-002 — hardcoded `18` decimals | Formatting and presentation (`lib/format`) |
| WEB-003 — success before confirmation | Transaction execution and finality |
| WEB-004 — `as any` type bypass | Type boundary + mechanical bans + `npm run typecheck` |
| WEB-005 — indexer/stream error handling | Discovery and projection trust + state honesty (the indexer itself was deleted 2026-07-31; see `test-accountability.md`) |
| WEB-006 — lint pipeline | `npm run lint:security` (`lint` + `check-banned-patterns.sh`), run by `pretest` |
| WEB-007 — env config assumptions | Configuration (`lib/config`, `lib/deployment`) |
| WEB-008 — network mismatch | Configuration (`lib/wagmi-config`) + wrong-network gating in `ActionModal` + chain enforcement in `useWriteFlow` |
| WEB-009 — claim MAX exceeds reserves | Action planning (`lib/actions` — matured claim capacity) |
| WEB-010 — withdraw fee not quantified | **No current owner.** The stream-withdraw card that carried this fee no longer exists; `WITHDRAW` in today's UI means withdraw liquidity. Historical record only — do not claim coverage for it without re-verifying against the current UI. |

---

## Execution expectations

Minimum gate before merging a `web/` change:

1. Run the tests covering the areas your diff touches.
2. Run the full unit + component suite: `npm --prefix web run test`.
3. Run `npm --prefix web run lint:security` and `npm --prefix web run build`.
4. Run the e2e suite when a flow, discovery hop, or executor path changed
   (`docs/agents/testing.md` first — environment collisions read like regressions).
5. Run the live parity suite when discovery, routing, or freshness changed.
6. Confirm no test intent was weakened without a matching `test-accountability.md`
   entry.
7. Run agent review per `docs/maps/REVIEW.md`.

## Refreshing this catalog

Do not hand-edit the counts. Run these, then write down what they say and the date:

```bash
# test files
find web/tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l

# case counts, per file and total
cd web && npx vitest run --reporter=json --outputFile=/tmp/vitest.json
node -e "const r=require('/tmp/vitest.json');
  console.log(r.numTotalTests, r.numPassedTests, r.numFailedTests);
  for (const t of r.testResults)
    console.log(t.assertionResults.length, t.name.replace(/^.*\/web\//, ''));"

# gherkin
find web/tests -name '*.feature' | wc -l
grep -cE '^\s*Scenario' web/tests/e2e/*.feature
```

If an area in this catalog no longer matches what those commands report, the catalog
is wrong — fix the catalog. If the *behavior* an area guards has disappeared, that is
an accountability event, not a documentation cleanup.
