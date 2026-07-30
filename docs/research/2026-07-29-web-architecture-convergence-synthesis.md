# Web review and structural architecture synthesis

**Date:** 2026-07-29  
**Status:** synthesis of three review-only artifacts; no code changes  
**Inputs:**

1. [2026-07-29-001 — Fix web review findings plan](../plans/2026-07-29-001-fix-web-review-findings-plan.md)
2. [2026-07-29-002 — Web structural architecture diagnosis](../plans/2026-07-29-002-web-structural-architecture-diagnosis.md)
3. [2026-07-29 — OVRFLO frontend architecture research](2026-07-29-ovrflo-frontend-architecture-research.md)

## Executive conclusion

The three artifacts converge on one decision:

> **Keep the current frontend, visual design, static-export model, App Router boundary, wagmi/TanStack/Reown stack, and narrow Ponder role; redraw the headless read-outcome and action-execution layers so completeness, preconditions, simulation, chain, receipt, and invalidation policy each have one owner.**

The documents do not support either a greenfield rewrite or continued form-by-form patching.

The apparent disagreements are mostly differences in:

- **Population:** current/open defects versus the full historical defect record.
- **Severity axis:** user-impact severity versus architectural migration priority.
- **Granularity:** one combined write-policy boundary versus separate action-definition and execution boundaries.
- **Sequencing:** fix every live defect first versus introduce the structural seam while fixing the live defect.

The authoritative combined direction is a **braided migration**: land the current findings in [2026-07-29-001](../plans/2026-07-29-001-fix-web-review-findings-plan.md), but implement the read and action findings through the target seams described below rather than creating short-lived patches that will immediately be replaced.

## What each source contributes

| Artifact | Primary role | Strongest contribution | What it should remain authoritative for |
|---|---|---|---|
| `2026-07-29-001` | Tactical remediation plan | Code-verified current findings, file-level implementation detail, tests, and acceptance criteria | The live defect inventory and acceptance criteria for Tasks 1–11 |
| `2026-07-29-002` | Historical structural diagnosis | Recurrence analysis across ~60 historical findings; detailed target layers; peer-derived action-module and flow-machine shape | Why the defects recur and the deeper migration architecture |
| `2026-07-29-ovrflo-frontend-architecture-research` | Independent current-state cross-check | Complete subsystem/flow map; current standards; OpenPendle affinity; explicit scope guards; distinction between healthy and unhealthy duplication | Current architecture verdict, non-regression constraints, and external validation |
| This synthesis | Reconciliation | Resolves terminology, scope, and ordering conflicts | Combined architecture decision and implementation sequence |

None of the source documents should be deleted or rewritten into this one:

- The tactical plan contains detailed tests and file-level acceptance criteria that should not be duplicated here.
- The structural diagnosis contains the full historical regression ledger and peer evidence.
- The research report contains the broadest subsystem and flow map.

## Where all three converge

### 1. The frontend should not be rewritten

All three preserve the existing:

- Next.js static export.
- Server `layout/page` wrapping a client wallet/application leaf.
- Reown AppKit connection stack.
- wagmi and TanStack Query.
- Typed generated ABIs.
- OVRFLO-specific pure planners and error mapping.
- Current visual design and component behavior.
- Narrow Ponder service.

The problem is not the framework or component tree. It is missing policy ownership between the current hooks, planners, and forms.

### 2. Read completeness is a structural boundary

All three identify the same recurring rule:

> **Unresolved, partial, stale, and unavailable are not valid financial values.**

The current manifestations are:

- Failed `withdrawableAmountOf` reads becoming `0n`.
- Multicall subcall failures becoming `0`, `1n`, or absent rows.
- Loading/RPC failure becoming `NO APPROVED MARKETS`.
- Stream discovery silently stopping at 100.
- Claim All treating an incomplete portfolio as complete.
- Historical recurrence of `undefined → []` and `undefined → 0` semantics.

The tactical fixes in Tasks 2, 3, 8, 9, and 10 are instances of one missing read-outcome contract.

### 3. Action policy has no single owner

All three identify the 1,729-line `ActionModal.tsx` and its six form families as the main drift surface.

The duplicated policies include:

- Input parsing.
- Final-action preconditions.
- Approval preconditions.
- Optimistic approval state.
- Step/`activeIndex` calculation.
- Final calldata derivation.
- Receipt interpretation.
- Invalidation scope.

The current invalid-approval, claim-cap, and negative-amount findings are not independent mistakes. They are evidence that one action exists in several subtly different representations.

### 4. One execution primitive should own the transaction lifecycle

All three support:

- Fresh pre-sign checks.
- `simulateContract` before the wallet prompt.
- An unoverrideable expected chain.
- A latched account and action snapshot while signing/confirming.
- Receipt truth from `receipt.status`.
- Action-derived invalidation.
- Awaited critical refresh before terminal success.
- The current delayed held-stream retries for indexer lag.

`useWriteFlow` and `useTxQueue` should not remain separate implementations of chain, receipt, and invalidation doctrine.

### 5. Ponder remains discovery/history, never current protocol truth

All three preserve the existing trust boundary:

- Ponder returns candidate stream IDs and historical demand.
- Sablier supplies current stream data and ownership.
- Factory, vault, and lending contracts supply current market and position state.
- No executable value should come from the indexer.

The change is a **completeness contract** for Ponder discovery, not a broader Ponder role.

### 6. Build/config lifecycle is a separate structural concern

All three agree that:

- Production builds must fail on missing required configuration.
- One explicit local-build escape hatch should cover intentional development defaults.
- CSP must be generated into deployment artifacts rather than mutating committed source.
- Final deployed headers must be verified against the exported HTML and configured origins.
- A prioritized RPC fallback is appropriate.

### 7. H-4/H-5 remain outside a frontend-only fix

All three preserve KTD11:

- Per-user lending indexes and bounded/cursored `gatherLiquidity` were declined.
- The oldest-500 ownership and market-depth cliff remains open.
- Reorganizing React code cannot prove owner discoverability at arbitrary protocol size.
- Ponder should not be expanded into authoritative protocol-state storage to hide this limitation.

The synthesis therefore treats H-4/H-5 as an explicit accepted residual unless the Solidity decision is reopened.

### 8. Behavioral tests must outlive component rewrites

The WEB-007 and WEB-009 regressions are shared evidence that a “FIXED” document entry is not a durable invariant.

Tests should be keyed to behavior:

- Missing production config fails.
- Claim MAX never exceeds series capacity.
- Failed read never renders as zero/empty.
- Invalid final action cannot be approved.
- Reverted or simulated-failing actions never render success.

They should not depend on a particular component name or file remaining alive.

## Where the documents diverge, and the resolution

| Topic | `001` | `002` | Architecture research | Synthesis resolution |
|---|---|---|---|---|
| Structural share | Ten/eleven live findings, not expressed as a structural percentage | ~40 of ~60 historical defects; 8 of 10 clusters | 15 of 16 current/open classes, ~94% | Keep both denominators. Say **~67% of the historical defect record and ~94% of the current/open classes are boundary-attributable**. Never combine them into one percentage. |
| P0 terminology | P1–P3 user-impact severities | Calls missing write/read ownership “P0” architecture findings | No P0 because no current theft or security-boundary bypass | Reserve **P0–P3 for active product/security severity**: there is no P0. Rank structural work separately as **Architecture Priority A–C**. |
| Number of missing layers | Implied through tactical tasks | “Missing two layers”: typed reads and shared action/flow policy | Four weak boundaries: read completeness, action definitions, executor, runtime/build | Two core product layers are missing: **Read Outcome** and **Action Policy**. Action execution is the lower half of Action Policy; build/runtime is supporting infrastructure. |
| Fix versus refactor order | Config → CSP; typed read work before dependent UI fixes; remaining tasks independently | Land all of `001`, then migrate the architecture | Baseline tests → typed reads → action definitions → runner → split → runtime | Use a **braided plan**: land every `001` acceptance criterion, but implement Tasks 3/10 through the read boundary and Tasks 5/7/11 through early action-module extraction. Do not create knowingly disposable patches. |
| Read-result type | Field-level `bigint \| null`, hook error/loading, plus `incomplete` flags | Universal typed result, possibly `ReadResult<T>` | Explicit `loading/ready/partial/unavailable` discriminant | Standardize one hook-level discriminant while allowing nullable unresolved fields inside partial entities. Avoid a parallel hierarchy of generic wrappers. |
| Query-key architecture | Extends existing wagmi hooks and invalidation | Proposes an Aave-style `queryKeysFactory`; domain queries should not ride raw wagmi keys | Keep existing wagmi/TanStack stack and exact invalidation | Add a domain query-key vocabulary for app-owned queries, but **do not replace wagmi’s generated keys wholesale**. Action definitions declare touched entities/contracts; the invalidator maps them to existing keys. |
| `useTxQueue` unification | Keeps the queue and fixes its inputs/status | Says `useWriteFlow` absorbs `useTxQueue` | Keeps visible queue; routes rows through one runner | Preserve `useTxQueue` as a multi-step **orchestrator**, but remove its independent execution engine. Both single actions and queue rows call the same execution primitive. |
| Review snapshot semantics | Re-plan Claim All at confirm; complete-or-fail discovery | Freeze review; require re-accept on material drift | Re-plan each pending queue leg after confirmation and fresh reads | Freeze what is shown for review; immediately before signing, refresh and simulate. If calldata-relevant values materially change, require re-accept. For Claim All, re-plan only unsent rows after each receipt. |
| Chain invariant | Fix plan does not focus on it | Describes chain ID as fully pinned and stronger than SE2 | Notes `{ chainId: configured, ...args }` lets the caller override it | Current behavior is **gated and default-pinned, but not structurally unoverrideable**. Remove `chainId` from caller input or spread caller data first and assign configured chain last. |
| Receipt truth | Current code distinguishes receipt status | Calls it partially enforced because it exists twice | Calls current behavior enforced, while noting duplicate engines | **Behavior is correct today; ownership is not.** Preserve semantics and remove the second implementation. |
| Invalidation quality | Scoped invalidation already exists | Mechanism is strong, scope remains call-site memory | Mechanism is strong; critical refresh is not awaited | Keep the current address-scoped mechanism initially. Derive its scope from the action definition and await the critical keys before success. |
| Aave lesson | Not central | Copy `TxActionsWrapper` shape | Aave still duplicates per-action approval/invalidation policy | Copy the **guard-chain and presentation-shell shape**, not Aave’s per-action data/write duplication. |
| Morpho lesson | Not central | Copy SDK action modules; reject deprecated protocol-state mirror | Copy Lite event completeness; reject Lite’s bare transaction button | These are complementary: use Morpho SDKs for action-module shape and Morpho Lite for discovery completeness; use neither transaction implementation wholesale. |
| Pendle affinity | Pendle rules appear through OVRFLO contract checks | Uses hosted SDK/docs because official app is closed source | Uses OpenPendle as the closest public static Pendle frontend | Use official Pendle docs for protocol semantics and OpenPendle for public frontend architecture. Clearly label OpenPendle as unaffiliated. |
| Next.js restructuring | Not material | Static single route is preserved | Explicitly confirms the RSC boundary and identifies missing route/global fallbacks | Preserve the current RSC/client boundary. Add `error.tsx`, `global-error.tsx`, and appropriate loading recovery; do not move wallet-chain reads to Server Components. |
| CSP deployment target | Leaves `vercel.ts` versus Build Output API open pending empirical verification | Models it as L0 build/config | Preserves Needs Verification | Do not select based on theory. Run `vercel build`, record evaluation order, then choose the documented artifact path that demonstrably carries final hashes and origins. |

## Canonical severity and priority model

The reports use `P0` in two incompatible ways. The combined record should use two axes.

### Product/security severity

This remains the severity of a current user-facing defect:

| Severity | Meaning in this synthesis |
|---|---|
| P0 | Active theft, security-boundary bypass, or catastrophic unrecoverable state |
| P1 | High-consequence availability, recoverability, or production-deployment failure |
| P2 | Predictable failed actions, false financial state, or material workflow correctness |
| P3 | Local accessibility, validation, documentation, or assurance defect |

Under this axis, **there is no current P0**.

### Architecture priority

| Priority | Boundary | Why |
|---|---|---|
| A | Read outcome/completeness | Largest current cluster; partial state can become confident financial state and corrupt aggregate actions |
| A | Action definition and execution | Primary recurrence channel; fixes repeatedly fail to propagate across forms and sibling engines |
| B | Build/runtime lifecycle | Can ship an unusable app or hide missing configuration as an empty protocol |
| C | Shared presentation primitives and process guards | Stops accessibility/status drift and “fixed in dead component” regressions |
| Accepted residual | Protocol-size lending discovery | Cannot be eliminated under the current contract and Ponder-scope decisions |

## Canonical target architecture

The target is six small layers plus cross-cutting behavioral verification.

### L0 — Build and runtime configuration

One build-time verifier owns:

- Required factory address.
- RPC and Ponder origins.
- One local-build escape flag.
- Final CSP artifact verification.
- Clean working tree after build.

The existing static-export model remains.

### L1 — Read outcome

Every domain hook returns an explicit state:

```ts
type ReadState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T; complete: true }
  | { status: "partial"; data: T; complete: false; failures: readonly ReadFailure[] }
  | { status: "unavailable"; data?: T; error: Error };
```

Rules:

- A failed subcall never becomes a valid domain value.
- A partial collection may retain successful siblings.
- Per-field overlays may use `bigint | null` inside partial entities.
- Aggregate actions require `ready` or an explicitly defined stale-but-complete state.
- Consumers cannot obtain data without also seeing its status.
- A lint/process guard should reject known read-default patterns where practical, but must not ban legitimate domain defaults such as the intentional `0 = unlimited` cap convention.

### L2 — Discovery

Ponder remains an ID/history service:

- `/streams` uses keyset pagination and returns `hasMore`.
- The client completes all pages or returns unavailable.
- A safety ceiling fails explicitly rather than returning a shorter set.
- Sablier re-hydrates every stream’s current state and ownership.
- Historical demand remains an explicitly non-authoritative signal.

Protocol lending discovery remains on-chain under the settled decision, including the known H-4/H-5 limitation.

### L3 — Pure action definitions

One pure module per OVRFLO action:

```ts
type ActionDefinition<Context> = {
  preconditions(context: Context): ValidationError | null;
  requirements(context: Context): readonly ApprovalRequirement[];
  buildTx(context: Context): FrozenTransaction;
  touched(context: Context): TouchedEntities;
  summarizeReceipt?(receipt: TransactionReceipt): ReceiptSummary | null;
};
```

Constraints:

- No React hooks in action modules.
- `preconditions` is the single source for both approval and final-action validity.
- `buildTx` owns submit-time clamping, slippage bounds, multicall encoding, and final arguments.
- `requirements` owns exact/buffered approvals and classified zero-first behavior.
- `touched` describes domain entities and contracts, not raw TanStack internals.
- OVRFLO-specific math stays explicit; do not build a generic DeFi DSL.

### L4 — One execution primitive

One framework-facing executor owns:

```text
connect
→ chain check
→ fresh dependency reads
→ requirements
→ approval
→ refresh/revalidate
→ simulate exact call
→ wallet signature
→ receipt
→ exact invalidation
→ await critical refresh
→ settled
```

It must:

- Latch account, chain, and accepted action snapshot.
- Make the configured chain impossible for a caller to override.
- Use the request returned by simulation.
- Distinguish simulation failure, user rejection, RPC failure, and mined revert.
- Preserve current product-specific error mapping.
- Derive invalidation from `action.touched()`.
- Retain delayed held-stream refreshes only where indexer lag requires them.

### L5 — Flow shell and form content

One `<ActionFlow>`-style shell owns:

- Connect/wrong-network state.
- Shared precondition rendering.
- Approval/action step rendering.
- Signing/confirming/refreshing/success/error states.
- Optimistic allowance reset behavior.
- Shared labeled amount/select primitives.

Individual forms own:

- Raw input text.
- Selected stream/tick.
- Action-specific disclosures.
- Product copy and layout.

The forms may be split into separate files only after policy extraction. File splitting by itself does not fix duplication.

### Queue composition

Claim All keeps its visible multi-row queue, pause/resume behavior, and per-row status, but:

- Each row executes through L4.
- The initial review requires a complete position set.
- Unsent rows are re-planned after each confirmed receipt.
- Material changes require a new acceptance step.
- An incomplete stream set can never end in unqualified `ALL CLAIMS CONFIRMED`.

### Cross-cutting verification

Every durable invariant gets a behavior-level test and, where appropriate, a review-accountability entry:

- The test must survive component renames and form extraction.
- A “FIXED” record is not complete until its behavior is pinned.
- Modal accessibility tests must open the modal rather than relying only on a base-route axe sweep.
- The production Reown path needs at least one verification surface distinct from the E2E wallet-runtime alias.

## Authoritative migration sequence

The sequence below reconciles “land the live fixes first” with “do not write disposable tactical code.”

### Tranche 0 — Lock behavior before touching structure

- Add or strengthen failing tests for each current finding.
- Key tests to user-observable behavior, not the current component name.
- Record the current expected visual output so the headless refactor cannot silently redesign the interface.

### Tranche 1 — Build/config closure

Implement:

1. `001` Task 4 — fail production builds on missing/zero factory and consolidate required-env validation.
2. `001` Task 1 — move CSP to a verified deployment artifact.

Reason:

- They interact through build mode and required origins.
- They are independent of the React/data refactor.
- `vercel build` remains the decision gate between `vercel.ts` and Build Output API.

### Tranche 2 — Establish L1 while closing read findings

Implement together:

1. `001` Task 10 — hook-level partial/unavailable semantics.
2. `001` Task 3 — nullable unresolved withdrawable overlays.
3. `001` Task 2 — paginated complete-or-fail stream discovery.
4. `001` Task 8 — market loading/error/ready UI.
5. `001` Task 9 — Claim All completeness.

This is not “fix Task 10, then later invent typed reads.” Task 10 is the first migration of the typed read boundary.

Acceptance:

- No failed read becomes `0`, `1n`, an absent row, or a confident empty collection.
- Successful siblings remain available in partial state.
- Claim All cannot execute over an unknown portfolio.
- A wallet with more than 100 streams receives all streams or an explicit failure.

### Tranche 3 — Establish L3 while closing action findings

Extract the first pure action definitions for Convert, Borrow, and Repay while implementing:

1. `001` Task 5 — approval inherits final-action preconditions.
2. `001` Task 7 — matured claim is bounded by wallet balance, `claimablePt`, and `marketTotalDeposited`.
3. `001` Task 11 — non-positive and malformed amounts fail at the shared input/action boundary.

Do not build the full generic flow shell yet. Keep the current forms rendering while making them consume one action definition.

Acceptance:

- Approval and final-action buttons consume the same `preconditions` result.
- Displayed amount, validated amount, and submitted amount come from one computation.
- No invalid amount reaches ABI encoding.

### Tranche 4 — Local accessibility closure

Implement `001` Task 6 at any safe point after its behavior test exists:

- Visible associated stream label.
- Modal-level role/name test.

Later L5 primitives must preserve the same behavior.

### Tranche 5 — Establish L4

- Add binding simulation.
- Make chain unoverrideable.
- Extract one execution primitive used by both single actions and queue rows.
- Derive invalidation from action definitions.
- Await critical refetch before terminal success.
- Preserve the existing receipt-status and error-mapping behavior.

Migrate single actions first. Migrate Claim All only after single-action behavior is stable.

### Tranche 6 — Establish L5 incrementally

- Build the shared flow shell.
- Migrate Supply first because it is the simplest approval/action flow.
- Migrate Convert, Repay, Adjust Rate, Simple Actions, and Borrow in increasing complexity.
- Keep Borrow last because it has the richest freshness, quote, partial-fill, and receipt-summary behavior.
- Run the relevant unit and E2E flow after each form migration before moving to the next.
- Split `ActionModal.tsx` as forms migrate; do not perform one large file-motion commit.

### Tranche 7 — Formalize freshness and assurance

- Freeze the reviewed snapshot.
- Refresh and simulate immediately before signing.
- Require explicit re-acceptance for material calldata changes.
- Re-plan unsent Claim All rows after each receipt.
- Restore route/global error recovery and appropriate loading UI without changing the existing server/client boundary.
- Wire CI for unit/build checks and the seeded E2E suite when its infrastructure requirements are available.
- Use `web/reviews/test-accountability.md` for every re-closed historical finding.

### Tranche 8 — Revisit or accept the protocol discovery residual

Choose explicitly:

- **Keep KTD11:** retain H-4/H-5 as accepted residuals and improve direct-contract recovery guidance.
- **Reopen the invariant:** implement minimal per-user lending indexes plus bounded/cursored `gatherLiquidity`, then consume them in the frontend.

Do not claim the frontend architecture migration closes H-4/H-5 while KTD11 remains in force.

## Definition of done for the combined direction

- Every acceptance criterion in `2026-07-29-001` passes.
- Hooks distinguish loading, ready, partial, and unavailable.
- No failed subcall silently defaults or disappears.
- A complete aggregate action cannot be constructed from incomplete discovery.
- Approval and action validity have one derivation.
- Each action has one pure definition for requirements, final transaction, touched entities, and receipt summary.
- Every final call is freshly simulated before signature unless a documented action-specific exemption exists.
- Call sites cannot override the expected chain.
- Single actions and Claim All use one execution primitive.
- Terminal success follows receipt confirmation and critical cache refresh.
- Build output contains current origins and inline-script hashes without modifying committed source.
- The current visual design, static export, RSC/client boundary, and Ponder trust scope remain intact.
- H-4/H-5 are either explicitly accepted or separately fixed; they are not silently attributed to this migration.
- Behavior-level tests prevent WEB-007/WEB-009-style regressions across future component rewrites.

## Final verdict

The artifacts are mutually reinforcing, not competing plans:

- `001` identifies **what is broken now**.
- `002` explains **why the same classes keep returning**.
- The architecture research verifies **which existing choices are sound and which peer patterns fit OVRFLO without overgeneralizing it**.

The synthesized decision is:

> **Land the live fixes through two new ownership seams—typed read outcomes and pure action definitions—then unify execution and flow rendering incrementally. Keep the framework, data-authority model, visual design, and protocol-specific behavior.**

This is a local structural refactor: broader than patching, substantially smaller and safer than a rewrite.
