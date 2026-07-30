# Web frontend canonical remediation plan — 2026-07-29

> **SUPERSEDED (2026-07-29, same day):** the canonical implementation plan is now [2026-07-29-003-frontend-fix-canonical-plan.md](2026-07-29-003-frontend-fix-canonical-plan.md), which absorbed this document's finding register (with verification markers), maintainer-decisions list, and forward-timestamp bound rule, and is strictly more implementable (per-phase exit gates, surfaces, verification commands, traceability). Do not implement from this file. It is retained only as provenance.

**Status:** ~~canonical~~ superseded. This document supersedes the three synthesis documents of 2026-07-29 (`docs/research/2026-07-29-frontend-architecture-synthesis.md`, `docs/research/2026-07-29-frontend-docs-synthesis.md`, `docs/research/2026-07-29-web-architecture-convergence-synthesis.md`) as the working direction for fixing the frontend. It does **not** supersede the three underlying evidence documents, which remain authoritative for their own scope:

- **[FIX]** [2026-07-29-001-fix-web-review-findings-plan.md](2026-07-29-001-fix-web-review-findings-plan.md) — the live defect inventory, file-level detail, tests, and acceptance criteria for Tasks 1–11.
- **[DIAG]** [2026-07-29-002-web-structural-architecture-diagnosis.md](2026-07-29-002-web-structural-architecture-diagnosis.md) — the historical regression ledger (~60 defects, 10 clusters), peer evidence, and why the same classes recur.
- **[RES]** [docs/research/2026-07-29-ovrflo-frontend-architecture-research.md](../research/2026-07-29-ovrflo-frontend-architecture-research.md) — the independent current-state subsystem/flow map, invariant table, and peer cross-check.

Provenance note: DIAG and RES were produced independently on the same day from the same commit and reached the same verdict through different peer sets — their agreement is evidence, not repetition. This plan takes the braided-migration strategy and two-axis severity model from the convergence synthesis, the session-verified facts and finding register from the architecture synthesis, and the orientation tables and external-conflict flag from the docs synthesis.

---

## 1. Verdict

**Keep the current frontend, visual design, static-export model, App Router boundary, wagmi/TanStack/Reown stack, and narrow Ponder role. Redraw the headless read-outcome and action-policy layers so completeness, preconditions, approval, simulation, chain, receipt, and invalidation each have exactly one owner.**

Neither a greenfield rewrite nor continued form-by-form patching is supported by the evidence. The migration is **braided**: every FIX acceptance criterion lands, but the read and action tasks are implemented *through* the target seams — Task 10 is the first migration of the typed-read boundary, Tasks 5/7/11 are the first action-module extractions — never as disposable patches the refactor would immediately replace.

Do not debate the structural percentage (~94% of current/open classes; ~2/3 of the historical record — different denominators, same conclusion). Debate the boundaries.

## 2. Severity model (two axes — the sources used "P0" incompatibly)

**Product/security severity** (current user-facing defects): P0 = active theft / security-boundary bypass / unrecoverable state; P1 = high-consequence availability, recoverability, or deployment failure; P2 = predictable failed actions or false financial state; P3 = local a11y/validation/assurance. **There is no current P0.**

**Architecture priority** (migration ranking):

| Priority | Boundary | Why |
|---|---|---|
| A | Read outcome / completeness | Largest current cluster; partial state becomes confident financial state and corrupts aggregate actions |
| A | Action definition + execution | The recurrence channel; fixes repeatedly fail to propagate across forms and sibling engines |
| B | Build/runtime lifecycle | Can ship an unusable app or render missing config as an empty protocol |
| C | Shared presentation primitives + process guards | Stops a11y/status drift and fixed-in-dead-component regressions |
| Accepted residual | Protocol-size lending discovery (H-4/H-5) | Cannot be eliminated under current contract + Ponder-scope decisions (§8, decision 1) |

## 3. Consolidated finding register

Merged from all three sources; ★ = verified in-session on 2026-07-29, not merely asserted.

| Finding | FIX | DIAG | RES | Route |
|---|---|---|---|---|
| CSP artifact lifecycle / committed `vercel.json` mutation | Task 1 | cluster 8 / B | P1 | Tranche 1 |
| Stream discovery silent truncation (limit=100, no cursor) | Task 2 | cluster 4→R | P1 | Tranche 2 |
| Failed reads → `0n`; overlay state omitted | Task 3 | cluster 1 / R | P1 | Tranche 2 |
| Zero factory accepted in prod (WEB-007 regression) | Task 4 | cluster 8 / B | P2 | Tranche 1 |
| Approval ignores action preconditions (×3 forms) | Task 5 | cluster 2 / W | P2 | Tranche 3 |
| Unnamed borrow stream `<select>` | Task 6 | local a11y | P3 (the one truly local defect) | Tranche 4 |
| Matured-claim MAX exceeds capacity (WEB-009 regression) | Task 7 | cluster 2 / W | P2 | Tranche 3 |
| Loading/RPC failure → "NO APPROVED MARKETS" | Task 8 | cluster 1 / R | P1 | Tranche 2 |
| Claim All false completion under failed discovery | Task 9 | cluster 5 / R | P1 | Tranche 2 |
| Multicall subcall failures erase state (×4 hooks) | Task 10 | cluster 1 / R | P1 | Tranche 2 |
| Negative amounts arm writes | Task 11 | cluster 2 / W | P2 | Tranche 3 |
| No mandatory final-call simulation | — | implicit (SE2 R1) | P2 | Tranche 5 |
| ★ Chain ID overridable: [`useWriteFlow.ts:82`](../../web/hooks/useWriteFlow.ts) spreads `...args` **after** `{ chainId: configuredChainId }`, so a future caller's `chainId` wins. Latent — no current call site passes one. One-line fix | — | Lane D entry corrected | P2 (latent) | Tranche 0 (immediate) |
| Single RPC transport, no fallback | — | Lane B note | P2 | Tranche 1 |
| ★ `error.tsx` / `global-error.tsx` / `loading.tsx` absent from `web/app/` despite NX-002/NX-003 recorded fixed — **fifth rewrite-regression instance** (after WEB-007, WEB-009, the dead-component error-boundary fix, revert-as-confirmed) | — | — | P3 assurance drift | Tranche 7 |
| Coverage informational / no E2E CI / E2E bypasses the production Reown path | — | Lane A test notes | P3 | Tranche 7 |
| H-4/H-5 enumeration cliff | — | settled (KTD11) | P1, decision demanded | Tranche 8 |
| Write-policy duplication (6 form machines, 2 engines) | — | P0-structural | P2 | Tranches 3/5/6 |

**Needs Verification (unresolvable from the repo):** which CSP artifact Vercel ultimately serves. Run `vercel build` / inspect production headers when Tranche 1 lands; that empirical result — not theory — chooses between `vercel.ts` and the Build Output API.

## 4. Target architecture

Six layers plus cross-cutting verification. Full type sketches and constraints live in the convergence synthesis; this is the binding summary.

- **L0 — Build/runtime config.** One build-time verifier owns: required factory, RPC + Ponder origins, one local-build escape flag, final-CSP-vs-exported-HTML verification, clean working tree after build. Static export stays.
- **L1 — Read outcome.** Every domain hook returns an explicit `loading | ready(complete) | partial(failures) | unavailable` state. A failed subcall never becomes a valid domain value; partial collections keep successful siblings; per-field overlays may be `bigint | null` inside partial entities; aggregate actions require `ready` (or an explicitly defined stale-but-complete state); consumers cannot obtain data without its status. A lint guard rejects read-default patterns but must not ban legitimate domain defaults (`0 = unlimited` cap).
- **L2 — Discovery.** Ponder stays an ID/history service: keyset-paginated `/streams` with `hasMore`; the client completes all pages or returns unavailable; a safety ceiling fails explicitly. Sablier re-hydrates all state and ownership. Lending discovery stays on-chain under KTD11.
- **L3 — Pure action definitions** (`web/lib/actions/*.ts`, no React): `preconditions` (the single source for approval **and** final-action validity), `requirements` (measured approvals; classified zero-first), `buildTx` (submit-time clamps, slippage bounds, multicall encoding — the math currently in components), `touched` (domain entities → invalidation), `summarizeReceipt`. OVRFLO-specific math stays explicit; no generic DeFi DSL, no protocol-state mirror (Morpho deprecated theirs — "no replacement package").
- **L4 — One execution primitive:** connect → chain check → fresh reads → requirements → approval → revalidate → **simulate the exact call and write the request simulation returns** → sign → receipt (`receipt.status`) → invalidation from `action.touched()` → **await critical refresh before terminal success** → settled. Latches account/chain/accepted snapshot; chain structurally unoverrideable; distinguishes simulation failure / user rejection / RPC failure / mined revert; keeps product error mapping and held-stream retries. `useTxQueue` survives as the visible multi-row **orchestrator** but loses its independent engine — every row executes through L4.
- **L5 — Flow shell + form content.** One `<ActionFlow>`-style shell (Aave `TxActionsWrapper` guard-chain shape — shell only; Aave's per-flow policy duplication is the anti-pattern) owns connect/wrong-network, shared precondition rendering, approve/action steps, signing/confirming/refreshing/success/error, optimistic-allowance reset, and labeled input/select primitives. Forms own raw input, selection, disclosures, copy. Files split only as forms migrate — the split is maintenance, not the fix.
- **Freshness semantics:** freeze what is shown at review; refresh + simulate immediately before signing; material calldata drift requires explicit re-accept; Claim All re-plans unsent rows after each receipt and can never end in unqualified "ALL CLAIMS CONFIRMED" over incomplete discovery. Forward-timestamp bounds for streaming collateral (a stream keeps streaming between quote and signature).
- **Cross-cutting verification:** every durable invariant gets a behavior-keyed test that survives component renames; a "FIXED" record is incomplete until its behavior is pinned; modal a11y tests open the modal; the production Reown path gets at least one verification surface distinct from the E2E `wallet-runtime` alias; `web/reviews/test-accountability.md` (currently empty) is actually used.

## 5. Migration sequence (braided tranches; each ships green)

**Tranche 0 — Lock behavior; land the one-liner.** Failing behavior-keyed tests for every register finding, plus the runner invariants no test covers today (simulation-failure-without-wallet-prompt, chain-override refusal, awaited-refresh-before-success). Land the ★chain-fix now: `{ ...args, chainId: configuredChainId }` (or strip `chainId` from the caller-facing type), pinned by its new test.

**Tranche 1 — Build/config closure.** FIX Tasks 4 then 1 (they share build-mode/env machinery); add the prioritized RPC `fallback()` transport (SE2-plan R6–R8). Run `vercel build` and record which artifact path demonstrably carries the final hashes and origins. Early on purpose: cheap, independent of the React refactor, and prevents shipping a broken artifact while the refactor runs.

**Tranche 2 — Establish L1 while closing the read findings.** FIX Tasks 10, 3, 2, 8, 9 implemented *as* the typed read boundary — not fixed tactically and re-migrated later. Acceptance: no failed read becomes `0`/`1n`/an absent row/a confident empty collection; successful siblings survive in partial state; Claim All cannot execute over an unknown portfolio; a wallet with >100 streams gets all streams or an explicit failure.

**Tranche 3 — Establish L3 while closing the action findings.** Extract action definitions for Convert, Borrow, Repay (they contain all three demonstrated drift patterns) while implementing FIX Tasks 5, 7, 11. Current forms keep rendering but consume one `preconditions` result. Acceptance: approval and action buttons share one derivation; displayed, validated, and submitted amounts come from one computation; no invalid amount reaches ABI encoding.

**Tranche 4 — Local a11y closure.** FIX Task 6 (any safe point after its behavior test exists); later L5 primitives must preserve it.

**Tranche 5 — Establish L4.** Binding simulation; latching; invalidation from `touched()`; awaited critical refresh; single actions first, Claim All only after single-action behavior is stable.

**Tranche 6 — Establish L5 incrementally.** Supply first (simplest), then Convert, Repay, Adjust Rate, Simple Actions; Borrow last (richest freshness/quote/partial-fill behavior). Relevant unit + E2E green after each form before the next; `ActionModal.tsx` splits as forms migrate — no single large file-motion commit.

**Tranche 7 — Formalize freshness and assurance.** Review-snapshot freeze + pre-sign refresh/simulate + re-accept on drift; restore `error.tsx` / `global-error.tsx` / loading recovery (without changing the server/client boundary); CI for unit/build and seeded E2E where infra permits; accountability log in use; stale review records (NX-002/NX-003, WEB-007, WEB-009 entries) corrected only after behavior is pinned.

**Tranche 8 — Decide the protocol-discovery residual explicitly** (§8, decision 1). Do not claim this migration closes H-4/H-5 while KTD11 stands.

## 6. Do not do

- Rewrite Next/wagmi/Reown; adopt SE2/`@scaffold-ui` components; move to server rendering for CSP or data flow.
- Expand Ponder into authoritative protocol state, or treat stream pagination (Task 2) as fixing lending H-4/H-5.
- Split `ActionModal.tsx` before extracting action policy — a six-file version with duplicated policy preserves every defect.
- Build a TS protocol-state mirror or generic DeFi abstraction layer.
- Re-raise the disproven Sablier H-1 (v1.1 ACL), re-litigate no-USD, dynamic decimals, `0 = unlimited`, or any entry in the settled ledgers of DIAG §8 / RES "Known and intentional."

## 7. Definition of done

Every FIX acceptance criterion passes; hooks distinguish loading/ready/partial/unavailable and no failed subcall silently defaults; aggregate actions cannot be built from incomplete discovery; approval and action validity have one derivation; each action has one pure definition (requirements, final tx, touched entities, receipt); every final call is freshly simulated before signature unless a documented exemption exists; call sites cannot override the chain; single actions and Claim All share one execution primitive; terminal success follows receipt **and** critical refresh; builds emit current origins/hashes without touching committed source; visual design, static export, RSC boundary, and Ponder trust scope are unchanged; H-4/H-5 are explicitly accepted or separately fixed; behavior-keyed tests block WEB-007/WEB-009-class regressions.

## 8. Decisions that belong to the maintainer

1. **H-4/H-5:** accept as documented residual (with direct-contract recovery guidance) or reopen per-user indexes + bounded/cursored `gatherLiquidity`. All sources agree nothing in between exists.
2. **Vercel verification:** someone with deploy access runs `vercel build` / inspects production headers after Tranche 1 — the only claim repository evidence cannot close.
3. **CI scope:** unit/build CI is uncontroversial; seeded-fork E2E in CI is an infrastructure cost call.
4. **Doc hygiene:** if [frontend-decision-map.md](../frontend-decision-map.md) or the [2026-07-28-002 remediation plan](2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md) still read as though per-user indexes are settled-to-implement, reconcile them with KTD11 in whichever direction decision 1 goes.
