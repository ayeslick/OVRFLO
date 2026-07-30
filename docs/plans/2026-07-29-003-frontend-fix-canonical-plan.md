# Canonical plan — fix the OVRFLO frontend without rewriting it

**Date:** 2026-07-29  
**Status:** canonical implementation plan; documentation only  
**Scope:** `web/` and `tools/ponder/`, except for the explicit H-4/H-5 decision gate  
**Supersedes:** the three synthesis documents evaluated below, and [2026-07-29-003-web-frontend-canonical-remediation-plan.md](2026-07-29-003-web-frontend-canonical-remediation-plan.md) (its finding register, maintainer decisions, and forward-timestamp bound rule are folded in here)  

## Decision

Keep the frontend and redraw the policy boundaries that currently let partial reads, action validity, and transaction lifecycle rules drift between hooks and forms.

This is not a greenfield rewrite. It is also not a pass of isolated patches.

The implementation must:

1. Close every verified finding in [2026-07-29-001](2026-07-29-001-fix-web-review-findings-plan.md).
2. Introduce explicit read completeness while closing the read findings.
3. Introduce pure action definitions while closing the approval, claim-cap, and amount findings.
4. Route single actions and Claim All through one execution primitive.
5. Preserve the current UI, static export, App Router server/client boundary, wagmi/TanStack/Reown stack, Ponder trust boundary, and OVRFLO-specific behavior.

The permanent ownership model is:

```text
build/config
    ↓
typed read outcome → complete discovery
    ↓
pure action definition
    ↓
one transaction executor
    ↓
shared flow shell + action-specific fields
```

## Evaluation of the three syntheses

The documents are complementary, but none should be used unchanged as the implementation plan.

| Document | Strongest material | Limitation as a fix plan | Decision |
|---|---|---|---|
| [Frontend architecture synthesis](../research/2026-07-29-frontend-architecture-synthesis.md) | Strongest evidence ledger, peer reconciliation, and two useful code checks: caller-overridable `chainId` and missing App Router recovery files | Dense research narrative; “land all of 001, then build the layers” can create disposable fixes; build/runtime work is split between early `001` tasks and a late hardening phase | Its verified facts and consolidated finding register are inlined below (“Finding provenance register”); its sequence is replaced |
| [Frontend docs synthesis](../research/2026-07-29-frontend-docs-synthesis.md) | Best short orientation, crosswalk, and “what not to do” list | Explicitly not a replacement; puts the test baseline after the first fix phase; gives too few phase exit criteria; flow-shell versus executor ordering remains ambiguous | Retain as an executive summary; do not implement from it |
| [Web architecture convergence synthesis](../research/2026-07-29-web-architecture-convergence-synthesis.md) | Best reconciliation of severity, ownership, read semantics, queue composition, and the braided migration | Still mixes research explanation with execution; repeats freshness work across later tranches; lacks a compact touched-surface and verification gate for each phase | Use as the architectural base, simplified and made executable here |

### Best-of judgment

- **Best evidence record:** frontend architecture synthesis.
- **Best orientation document:** frontend docs synthesis.
- **Best architectural base:** web architecture convergence synthesis.
- **Best document to implement from:** this plan, because it turns the shared conclusion into ordered changes with exit gates.

The synthesis documents remain useful provenance. They should not be edited while this plan is implemented.

## What is actually wrong

There is no current evidence that Next.js, wagmi, Reown, TanStack Query, static export, or the visual design is the root problem.

The recurring failures are concentrated at four ownership boundaries:

| Boundary | Current failure modes | Permanent owner |
|---|---|---|
| Read outcome and completeness | Failed subcalls become `0n`, `1n`, absent rows, or confident empty UI; discovery stops silently; Claim All accepts an unknown portfolio | Domain hooks return an explicit outcome; discovery exposes completeness |
| Action definition | Approval and submit gates differ; MAX, bounds, parsing, and calldata are recomputed in forms | One pure definition per on-chain action |
| Transaction execution | Two engines repeat chain, receipt, invalidation, and queue behavior; no binding final-call simulation; critical refresh is not awaited | One executor; queue retains orchestration only |
| Build/runtime lifecycle | Production can accept unusable configuration; CSP generation mutates a committed input; recovery files and assurance records drift | One production verifier and deployment-artifact path |

The unnamed borrow selector is a local accessibility defect. It should be fixed directly and then protected by a modal-level test.

## Finding provenance register

Every open item this plan closes, mapped to where it was established. Sources: **[FIX]** [2026-07-29-001](2026-07-29-001-fix-web-review-findings-plan.md), **[DIAG]** [2026-07-29-002](2026-07-29-002-web-structural-architecture-diagnosis.md), **[RES]** [architecture research](../research/2026-07-29-ovrflo-frontend-architecture-research.md). DIAG and RES were produced independently from the same commit; their agreement is corroboration, not repetition. ★ = verified directly in code on 2026-07-29, not merely asserted. Phase routing lives in the traceability table below, not here.

| Finding | FIX | DIAG | RES | Verified |
|---|---|---|---|---|
| CSP artifact lifecycle / committed `vercel.json` mutation | Task 1 | cluster 8 / B | P1 | code + Vercel docs; deployed-header outcome still Needs Verification |
| Stream discovery silent truncation (limit=100, no cursor) | Task 2 | cluster 4→R | P1 | code |
| Failed reads → `0n`; overlay state omitted | Task 3 | cluster 1 / R | P1 | code |
| Zero factory accepted in prod (WEB-007 regression) | Task 4 | cluster 8 / B | P2 | code + test pins it |
| Approval ignores action preconditions (×3 forms) | Task 5 | cluster 2 / W | P2 | code |
| Unnamed borrow stream `<select>` | Task 6 | local a11y | P3 | code |
| Matured-claim MAX exceeds capacity (WEB-009 regression) | Task 7 | cluster 2 / W | P2 | code incl. [OVRFLO.sol:437-438](../../src/OVRFLO.sol) |
| Loading/RPC failure → "NO APPROVED MARKETS" | Task 8 | cluster 1 / R | P1 | code |
| Claim All false completion under failed discovery | Task 9 | cluster 5 / R | P1 | code (grep: PositionSummary consumes neither `stale` nor `unavailable`) |
| Multicall subcall failures erase state (×4 hooks) | Task 10 | cluster 1 / R | P1 | code |
| Negative amounts arm writes | Task 11 | cluster 2 / W | P2 | code |
| No mandatory final-call simulation | — | implicit (SE2-plan R1) | P2 | design gap, not disputed |
| ★ Chain ID caller-overridable: [`useWriteFlow.ts:82`](../../web/hooks/useWriteFlow.ts) spreads `...args` after `{ chainId: configuredChainId }` | — | Lane D entry corrected | P2 (latent — no current call site passes one) | **★ code** |
| Single RPC transport, no fallback | — | Lane B note | P2 | code |
| ★ `error.tsx` / `global-error.tsx` / `loading.tsx` absent despite NX-002/NX-003 recorded fixed — fifth rewrite-regression instance (after WEB-007, WEB-009, the dead-component error-boundary fix, revert-as-confirmed) | — | — | P3 assurance drift | **★ directory listing + NX records** |
| Coverage informational / no E2E CI / E2E bypasses production Reown path | — | Lane A test notes | P3 | config |
| H-4/H-5 enumeration cliff | — | settled (KTD11) | P1, decision demanded | audit + KTD11 |
| Write-policy duplication (6 form machines, 2 engines) | — | P0-structural | P2 | grep inventories (Lane D) |

## Severity and priority

Use separate axes:

- `P0`–`P3` describe active user/security impact. Under that definition, no current P0 was found.
- `A`–`C` describe migration priority.

| Architecture priority | Work |
|---|---|
| A | Typed read outcome and complete discovery |
| A | Pure action definitions and one execution primitive |
| B | Build/config/CSP lifecycle |
| C | Shared flow presentation and assurance/process guards |
| Accepted residual or separate protocol project | H-4/H-5 lending discovery at protocol scale |

Do not combine the historical “about two-thirds” figure and the current/open “about 94%” figure. They use different denominators and do not affect the implementation choice.

## Non-negotiable constraints

Preserve:

- Next.js static export.
- `app/layout.tsx` and `app/page.tsx` as Server Components with the wallet application below the client boundary.
- Client-side wallet and chain reads; do not move them into Server Components merely to follow a generic Next.js preference.
- Reown AppKit, wagmi, viem, and TanStack Query.
- Typed generated ABIs.
- Ponder as discovery/history only; chain contracts remain authoritative.
- OVRFLO-specific planners, error mapping, receipt summaries, and delayed stream refresh for indexer lag.
- No-USD presentation.
- `0 = unlimited`.
- Pendle PT 18-decimal assumptions.
- Cross-market `ovrfloToken` fungibility.
- Freeze what the user reviews; refresh and recompute before submission.
- Classified zero-first approval behavior.
- The current visual design and copy unless a finding requires an accessibility or state-clarity change.

Do not:

- Rewrite the frontend.
- Adopt a generic DeFi form framework or protocol-state mirror.
- Make Ponder authoritative for executable state.
- Split `ActionModal.tsx` before extracting the duplicated policy.
- Replace wagmi query keys wholesale.
- Claim that React work fixes H-4/H-5.
- Reopen disproven Sablier-withdrawal findings.

## Target contracts between layers

These are behavioral contracts, not a demand for a large abstraction hierarchy.

### 1. Domain read outcome

Every domain hook that can be partially resolved must make the outcome inseparable from its data:

```ts
type ReadOutcome<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T; freshness: "fresh" | "stale" }
  | {
      status: "partial";
      data: T;
      freshness: "fresh" | "stale";
      failures: readonly ReadFailure[];
    }
  | { status: "unavailable"; data?: T; error: Error };
```

Rules:

- A failed read is never converted into a valid domain value.
- Successful siblings remain visible in `partial`.
- A field inside a partial entity may be `null`; it may not use `0n` as “unknown.”
- Empty is valid only after a complete successful read.
- Aggregate actions require `ready` and fresh action-critical data.
- UI may display explicitly stale complete data, but cannot use it to construct an action without revalidation.
- A banned-pattern check may target known read-default idioms, but must not reject legitimate protocol defaults such as `0 = unlimited`.

Do not force every hook in the repository through a generic wrapper in one commit. Establish the contract on the affected hooks, then expand only where the same semantics apply.

### 2. Discovery completeness

`/streams` must support keyset pagination and return enough metadata to distinguish a complete result from a page:

```ts
type StreamPage = {
  ids: readonly bigint[];
  nextCursor: string | null;
  hasMore: boolean;
};
```

The client must:

- Fetch every page before reporting a complete portfolio.
- Deduplicate IDs defensively.
- Fail explicitly if a safety ceiling is reached.
- Rehydrate current stream state and ownership from Sablier.
- Never present a partial page as the complete input to Claim All.

### 3. Pure action definition

The exact TypeScript spelling should be locked by the first extraction, but each action must have one pure owner for:

```ts
type ActionDefinition<Context> = {
  preconditions(context: Context): ValidationError | null;
  requirements(context: Context): readonly ApprovalRequirement[];
  build(context: Context): PreparedCall;
  touched(context: Context): TouchedEntities;
  summarizeReceipt?(receipt: TransactionReceipt): ReceiptSummary | null;
};
```

Rules:

- No React hooks in action definitions.
- Approval and final submission consume the same `preconditions`.
- Parsing, submit-time clamps, slippage/minimum bounds, and multicall encoding live here.
- Bounds derived from streaming collateral are computed at a forward timestamp, not the current one — a Sablier stream keeps streaming between quote and signature, so a bound computed "now" can revert on quiet markets (the Morpho SDK forward-accrual discipline).
- `requirements` owns exact/buffered approval and zero-first classification.
- `touched` names domain entities/contracts, not TanStack internals.
- The invalidator maps those entities to existing wagmi and app-owned keys.
- OVRFLO math stays explicit; do not create an inheritance tree or generic DeFi DSL.

### 4. One execution primitive

The executor owns:

```text
connect
→ expected-chain check
→ refresh action-critical dependencies
→ rebuild and compare the prepared action
→ obtain required approvals
→ refresh again when an approval can change requirements
→ simulate the exact final call
→ sign the request returned by simulation
→ wait for receipt
→ verify receipt.status
→ invalidate action-derived scope
→ await critical refresh
→ expose terminal success
```

It must:

- Make `chainId` impossible for callers to supply or override.
- Latch account, chain, and accepted review snapshot once signing begins.
- Distinguish simulation failure, user rejection, RPC failure, and mined revert.
- Preserve current product-specific error mapping.
- Require re-acceptance if a refreshed value materially changes calldata or user outcome.
- Keep delayed held-stream retries only for known indexer lag.

`useTxQueue` remains the Claim All row/state orchestrator. It must stop being a second write engine. Each row uses the same executor, and each unsent row is rebuilt after the previous receipt.

### 5. Shared flow shell

After action policy and execution are extracted, one flow shell may own:

- Connect and wrong-network presentation.
- Preconditions and approval/action step rendering.
- Signing, confirming, refreshing, success, and error screens.
- Optimistic allowance reset behavior.
- Shared labeled amount/select primitives.

Action forms retain only field state, selection, disclosures, product copy, and layout.

## Implementation sequence

Every phase must merge green. Write the behavior test before or with its fix; do not merge an intentionally failing test-only state.

### Phase 0 — Establish the baseline

Create a traceability table mapping every open item to its behavior test:

- `001` Tasks 1–11.
- Simulation failure never opens a wallet prompt.
- A call site cannot override the configured chain.
- Mined revert is not success.
- Terminal success waits for critical refresh.
- Complete, partial, unavailable, and true-empty reads render differently.
- Modal accessibility is tested with the modal open.

Capture current screenshots or Playwright snapshots for the primary modal states only where stable enough to catch an accidental redesign.

**Exit gate**

- Every finding has a named test target and intended layer owner.
- Existing frontend unit tests pass before structural edits.
- No test is tied solely to a component filename that the migration will remove.

### Phase 1 — Close build/runtime and local safety defects

Implement:

1. `001` Task 4: fail production builds on missing or zero factory configuration.
2. `001` Task 1: generate CSP in a deployment artifact, never by mutating committed `web/vercel.json`.
3. Make `chainId` unoverrideable immediately by removing it from the caller-facing write type or assigning the configured value after caller arguments.
4. `001` Task 6: give the borrow stream selector a visible associated label.
5. Restore appropriate `app/error.tsx`, `app/global-error.tsx`, and `app/loading.tsx` recovery files. These complement; they do not replace client RPC loading/error states.
6. Add the prioritized RPC `fallback()` transport (SE2-plan R6–R8 shape) — it pairs naturally with the config work here; its failure behavior is verified in Phase 6.

Use one explicit development escape hatch for intentional local defaults. Production must fail closed.

Determine the CSP target empirically:

- Run `vercel build` with production-shaped configuration.
- Record whether `vercel.ts`, Build Output API configuration, or another documented artifact supplies the final response headers.
- Verify final hashes and configured origins against exported HTML.
- Verify a build leaves tracked files unchanged.

**Likely surfaces**

- `web/lib/config.ts`
- `web/scripts/build-csp.mjs`
- `web/scripts/csp-hash-inline.mjs`
- `web/vercel.json` or the verified deployment artifact
- `web/hooks/useWriteFlow.ts`
- `web/app/{error,global-error,loading}.tsx`
- `web/components/ActionModal.tsx`

**Exit gate**

- Missing production configuration fails the build with a useful error.
- Local development still works only through the documented escape hatch.
- Production CSP contains required current origins and hashes, excludes localhost, and is not sourced through a mid-build mutation of a committed file.
- Callers cannot type or spread a different `chainId` into the write.
- Recovery files conform to App Router requirements: error boundaries are client components; `global-error.tsx` renders `<html>` and `<body>`.
- The borrow selector has a stable accessible name.

### Phase 2 — Establish read outcome and complete discovery

Close `001` Tasks 2, 3, 8, 9, and 10 through the permanent read boundary.

Order:

1. Introduce the minimum shared outcome vocabulary and failure metadata.
2. Migrate the affected multicall hooks without changing their successful data model unnecessarily.
3. Include overlay reads such as `withdrawableAmountOf` in hook loading/error/outcome.
4. Add paginated Ponder stream discovery and complete-or-explicit-failure client aggregation.
5. Update Markets, PositionList, and PositionSummary consumers.
6. Make Claim All require a fresh, complete portfolio.

**Likely surfaces**

- `web/hooks/useAllMarkets.ts`
- `web/hooks/useHeldStreams.ts`
- `web/hooks/useLending.ts`
- `web/hooks/useLendingLiquidity.ts`
- `web/hooks/useLoanBook.ts`
- `web/hooks/useBorrowerLoans.ts`
- `web/lib/ponder.ts`
- `tools/ponder/src/api/index.ts`
- `web/components/MarketsApp.tsx`
- `web/components/MarketsTable.tsx`
- `web/components/PositionSummary.tsx`

**Exit gate**

- No affected failed subcall becomes `0`, `1n`, an omitted row, or a confident empty collection.
- Successful siblings remain available in a partial result.
- Loading, unavailable, partial, ready-empty, and ready-populated states are distinguishable.
- More than 100 streams returns all streams or an explicit failure.
- Claim All cannot start or finish with an incomplete portfolio.
- Ponder still supplies IDs/history only.

### Phase 3 — Establish action ownership while closing action defects

Close `001` Tasks 5, 7, and 11 by extracting the affected policy.

Order:

1. Lock the action-definition shape on the matured-claim/Convert path.
2. Move claim capacity to one calculation bounded by wallet balance, `claimablePt`, and `marketTotalDeposited`.
3. Move positive-amount parsing and validation to the shared action/input boundary.
4. Extract Repay and Borrow definitions so approval and final action use identical preconditions.
5. Move action-specific calldata math out of the component only when that action is migrated.

Do not build the shared flow shell yet. Existing forms may render the new pure definitions.

**Likely surfaces**

- New `web/lib/actions/`
- Existing pure planners in `web/lib/`
- `web/components/ActionModal.tsx`
- Focused tests under `web/tests/lib/` and `web/tests/components/`

**Exit gate**

- Approval cannot be enabled when the final action is invalid.
- Displayed, validated, approved, and submitted values derive from the same action context.
- Matured-claim MAX and manual input cannot exceed current series capacity.
- Non-positive or malformed amounts never reach ABI encoding.
- Action modules contain no React hooks and retain explicit OVRFLO terminology.

### Phase 4 — Build one executor and compose Claim All through it

Upgrade the existing single-write path instead of adding a third engine.

Order:

1. Add binding simulation and submit the request returned by simulation.
2. Add explicit executor states for revalidating, approving, simulating, signing, confirming, refreshing, success, and failure.
3. Derive invalidation from the action definition.
4. Await action-critical refresh before success.
5. Migrate one simple single action first to prove the executor.
6. Migrate remaining single actions.
7. Convert `useTxQueue` into orchestration over the executor while preserving row status, pause/resume, signer-change safety, and partial completion.
8. Rebuild every unsent Claim All row after the preceding receipt; require re-acceptance for material changes.

**Exit gate**

- No final call reaches the wallet after a failed simulation.
- Configured chain, account, and accepted plan cannot change under an in-flight action.
- Mined reverts, rejected signatures, simulation failures, and RPC failures have distinct terminal outcomes.
- Invalidations are derived, address-scoped, and awaited where the just-submitted action depends on the refreshed value.
- Single actions and Claim All have one chain/receipt/invalidation implementation.
- An incomplete or partially failed queue cannot display `ALL CLAIMS CONFIRMED`.

### Phase 5 — Add the shared flow shell and split the modal incrementally

Only now remove presentation duplication.

Order:

1. Build the flow shell around the action definition and executor.
2. Migrate Supply first as the simplest approval/action presentation.
3. Migrate Convert, Repay, Adjust Rate, and simple actions.
4. Migrate Borrow last because it has the richest quote, freshness, partial-fill, and receipt-summary behavior.
5. Split form content into separate files as each form migrates.
6. Replace duplicated amount/select markup with labeled primitives only where behavior is truly shared.

**Exit gate**

- A new action supplies fields plus one action definition; it does not add a new step machine, approval gate, receipt doctrine, or invalidation list.
- Every migrated form retains its existing user-visible behavior and disclosures.
- Connect/wrong-network, approval, action, confirmation, refresh, success, and error states have one presentation owner.
- Modal role/name and keyboard behavior remain covered.
- No wallet/chain Client Component is converted into an async Client Component or receives non-serializable Server Component props.

### Phase 6 — Make the fix durable

1. Add behavior-level regression coverage for every re-closed finding.
2. Use `web/reviews/test-accountability.md` for every `FIXED` claim.
3. Correct stale review records only after the corresponding behavior test passes.
4. Add unit/build checks to CI.
5. Add seeded E2E to CI only if the archive-RPC cost and single-environment constraints are explicitly accepted.
6. Add at least one verification surface for the production Reown path, separate from the E2E wallet-runtime alias.
7. Verify the failure behavior of the RPC fallback transport added in Phase 1.

**Exit gate**

- Component extraction or rename cannot delete the only test for a fixed behavior.
- CI blocks unit, lint/security, type/build, and static-export regressions.
- E2E remains single-worker and uses the documented bootstrap lifecycle.
- Review status matches executable evidence.

### Phase 7 — Decide H-4/H-5 separately

Choose one:

1. Keep KTD11 and document H-4/H-5 as accepted protocol-size discovery residuals, including direct-contract recovery guidance.
2. Reopen Solidity work for minimal per-user lending indexes and bounded/cursored `gatherLiquidity`, then create a separate contract-and-frontend plan.

Do not expand Ponder authority or claim that Phases 0–6 resolve this limitation.

## Verification matrix

Run targeted tests during each phase, then the full frontend checks at every phase exit:

```bash
npm --prefix web run lint:security
npm --prefix web run test
npm --prefix web run build
```

Build verification must also confirm that tracked files remain unchanged.

Run E2E for each migrated user flow and once in full after Phases 4–6:

```bash
set -a && . ~/.config/ovrflo/env && set +a
npm --prefix web run bootstrap:e2e
npm --prefix web run test:e2e
npm --prefix web run bootstrap:local:clean
```

Follow [the repository testing guide](../agents/testing.md):

- Never run two E2E/bootstrap processes concurrently.
- Use the one-shot bootstrap.
- Confirm Anvil, Ponder, and the dev server are healthy before classifying a cascade as a regression.
- Clean up only an environment started and owned by the current run.

No Solidity verification is required for Phases 0–6. If Phase 7 reopens contract work, use a separate plan and run `forge build` before `forge test`.

## Traceability to the live findings

| `001` item | Permanent phase | Durable owner |
|---|---|---|
| Task 1 — CSP artifact | 1 | Build/runtime |
| Task 2 — stream pagination | 2 | Discovery completeness |
| Task 3 — failed withdrawable read | 2 | Read outcome |
| Task 4 — zero factory | 1 | Build/runtime |
| Task 5 — approval validity | 3 | Action definition |
| Task 6 — unnamed selector | 1 | Accessible field; later shared primitive |
| Task 7 — matured-claim capacity | 3 | Action definition |
| Task 8 — false empty markets | 2 | Read outcome + consumer state |
| Task 9 — false Claim All completion | 2 and 4 | Complete discovery + queue executor |
| Task 10 — multicall defaults/drops | 2 | Read outcome |
| Task 11 — negative amounts | 3 | Action/input boundary |
| Mandatory final-call simulation | 4 | Executor |
| Caller-overridable `chainId` | 1, retained by 4 | Write boundary/executor |
| Critical refresh before success | 4 | Executor |
| Missing route/global recovery | 1 | App Router recovery |
| Assurance-record drift | 6 | Behavior tests + accountability |

## Decisions that belong to the maintainer

Four calls this plan cannot make; everything else proceeds without input.

1. **H-4/H-5 (Phase 7):** accept as documented residual with direct-contract recovery guidance, or reopen minimal per-user lending indexes plus bounded/cursored `gatherLiquidity`. Every source document agrees nothing in between exists.
2. **Vercel verification (Phase 1 gate):** someone with deploy access runs `vercel build` / inspects production headers once the CSP artifact work lands — the only open claim repository evidence cannot close.
3. **CI scope (Phase 6):** unit/build CI is uncontroversial; seeded-fork E2E in CI is an infrastructure cost call (archive-RPC usage, single-environment constraint).
4. **Doc hygiene after decision 1:** if [frontend-decision-map.md](../frontend-decision-map.md) or the [2026-07-28-002 remediation plan](2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md) still read as though per-user indexes are settled-to-implement, reconcile them with KTD11 in whichever direction decision 1 goes — otherwise the next reviewer re-derives the conflict.

## Definition of done

The frontend fix is complete only when:

- Every acceptance criterion in `2026-07-29-001` passes.
- Failed or incomplete reads cannot masquerade as zero, empty, or complete state.
- Claim All requires a complete portfolio and cannot overstate completion.
- Approval and final action validity have one derivation.
- Every action has one owner for requirements, final call, touched entities, and receipt interpretation.
- Every final call is refreshed and simulated before signature.
- Callers cannot override the expected chain.
- Single actions and queue rows share one execution primitive.
- Terminal success follows a successful receipt and required cache refresh.
- Production configuration fails closed.
- CSP ships from a verified deployment artifact without mutating committed source.
- App Router and client RPC failures have honest recovery/loading states.
- Behavior-level tests survive component and file restructuring.
- The visual design, static export, RSC/client boundary, Ponder role, and OVRFLO-specific decisions remain intact.
- H-4/H-5 are explicitly accepted or handled by a separate protocol change; they are not misreported as fixed.

## Final instruction

Implement from this plan and use the three syntheses only as provenance.

The shortest safe route is:

> **Fix deployment and local safety first; establish typed reads while closing read defects; establish action definitions while closing action defects; unify execution; split presentation last; make every fixed behavior durable.**
