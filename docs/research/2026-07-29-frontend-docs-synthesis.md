# Synthesis — three 2026-07-29 frontend docs

**Date:** 2026-07-29  
**Inputs:**

| Doc | Path | Role |
|-----|------|------|
| **001** | [`docs/plans/2026-07-29-001-fix-web-review-findings-plan.md`](../plans/2026-07-29-001-fix-web-review-findings-plan.md) | Tactical fix plan — 10 code-verified findings, task-level acceptance |
| **002** | [`docs/plans/2026-07-29-002-web-structural-architecture-diagnosis.md`](../plans/2026-07-29-002-web-structural-architecture-diagnosis.md) | Structural diagnosis — ~60 historical defects → boundaries; target L0–L5 + migration |
| **Research** | [`docs/research/2026-07-29-ovrflo-frontend-architecture-research.md`](./2026-07-29-ovrflo-frontend-architecture-research.md) | Architecture research — current/open classes, peer board, headless target |

**Purpose of this file:** show where the three converge, where they diverge, and what to treat as the reconciled working position. Not a replacement for any of them.

---

## One-line each

| Doc | Says |
|-----|------|
| **001** | Ship these ten fixes now; none are fixed yet; concrete files and tests. |
| **002** | Bug rate is structural because *policy* has no owner (forms copy gates/reads); insert action modules + shared flow machine + typed reads — not a rewrite. Land 001 first. |
| **Research** | 15/16 *current* open classes are structural on four narrow boundaries; keep visuals; redraw headless read-model + transaction policy. |

---

## Convergence (high confidence — all three agree)

### Verdict shape

- Defects are **mostly structural**, not “forgot a check.”
- **Not** a greenfield frontend rewrite.
- **Not** endless form-level patches alone — policy must gain an owner.
- Keep: pure planners, indexer-as-discovery, scoped write-triggered invalidation, static export, no-USD, settled product assumptions (18-dec PT, fungibility, etc.).

### Shared defect clusters (all three name these)

| Cluster | 001 tasks | 002 cluster | Research boundary |
|---------|-----------|-------------|-------------------|
| CSP / committed `vercel.json` mutation | Task 1 (P1) | B / cluster 8 | P1 deploy CSP |
| Stream discovery silent truncate (`limit=100`) | Task 2 (P1) | half of cluster 4 | P1 incomplete reads |
| Failed `withdrawable` → `0n` | Task 3 (P2) | R / cluster 1 | P1 incomplete reads |
| Zero / missing factory in prod | Task 4 (P2) | B / WEB-007 | P2 runtime config |
| Approval gates ≠ action gates | Task 5 (P2) | W / cluster 2 | P2 action validity |
| Unnamed stream `<select>` | Task 6 (P3) | local a11y | P3 local |
| Matured-claim MAX / WEB-009 | Task 7 (P2) | W / rewrite regression | P2 action validity |
| Loading/error → “NO APPROVED MARKETS” | Task 8 (P2) | R / cluster 1 | P1 incomplete reads |
| Claim All ignores `stale`/`unavailable` | Task 9 (P2) | R / cluster 5 | P1 incomplete reads |
| Multicall subcall → default/drop | Task 10 (P2) | R / cluster 1 | P1 incomplete reads |
| Negative amounts | Task 11 (P3) | W / cluster 2 | P2 action validity |

**001 is the executable surface of the shared diagnosis.** 002 and Research both treat 001 as the live defect list / first ship tranche.

### Shared architectural prescription

| Target piece | 001 | 002 | Research |
|--------------|-----|-----|----------|
| Typed / non-zeroing read results | Tasks 3, 8, 10 (shape L1) | **L1** `ReadResult` | Typed `ReadResult` / complete\|partial\|unavailable |
| Single approve→action policy owner | Task 5 shared preconditions | **L5** `<ActionFlow>` (Aave) | Single action runner + shared preconditions |
| Pure action definitions (math out of forms) | Task 5 “named derivation”; Task 7 capacity | **L3** `lib/actions/*` (Morpho) | `web/lib/actions/*.ts` ActionDefinition |
| Unify `useWriteFlow` ∥ `useTxQueue` | (implicit via Claim All trust) | **L4** one write engine | Route queue through same runner |
| Build/env/CSP ownership | Tasks 1, 4 | **L0** | Migration step 6 |
| Keep Ponder discovery-only | Task 2 pagination only | Explicit | Explicit |

### Shared “do not re-litigate”

- No USD feed.
- Indexer not authority for executable state.
- Static export.
- WEB-007 / WEB-009 are rewrite regressions — tests must key *behavior*, not deleted component names.
- SE2 UI rebuild rejected; selective SE2 hardening (simulate, fallback RPC) still valuable.
- Sablier audit H-1 disproven (v1.1 ACL) — Research states explicitly; 002/001 don’t re-open it.

---

## Divergence (real disagreements or different frames)

### 1. Counting frame → different “structural %”

| Doc | Denominator | Claim |
|-----|-------------|-------|
| **001** | 10 verified open findings | Doesn’t claim a %; implies all are ship-blocking or quality |
| **002** | ~60 historical recorded defects | ~2/3 → four boundaries (R, W, B + settled protocol) |
| **Research** | 16 *current/open product classes* | 15/16 ≈ 94% structural |

**Reconcile:** Same qualitative answer. Research’s higher % is selection bias (current open only). 002’s lower % includes historical fixed items and local a11y. **Do not debate the percentage — debate the boundaries.**

### 2. Severity labels (P0)

| Doc | P0? |
|-----|-----|
| **001** | Uses P1–P3 only for the ten findings |
| **002** | **P0** — write policy has no owner; **P0** — read results untyped |
| **Research** | **No P0** — no path found that enables theft / bypasses on-chain security |

**Reconcile:** Research’s P0 = *security/theft*. 002’s P0 = *structural recurrence that will keep shipping user-facing financial lies*. Both can be true. Prefer Research’s language for security triage; prefer 002’s for migration priority (typed reads + action ownership first).

### 3. H-4 / H-5 lending enumeration cliff

| Doc | Position |
|------|----------|
| **001** | **Silent** — does not task position/loan `enumerateIds(1..500)`; only stream pagination (Task 2) |
| **002** | **Known open / declined** — KTD11: per-user on-chain indexes declined; half settled, half client completeness |
| **Research** | **Known open / declined** — cannot prove “every owner discovers every position” without reopening Solidity; else accept residual risk |

**Reconcile:** All three that speak agree the *frontend* cannot finish H-4/H-5. 001 correctly scopes to stream completeness (same *class*, different surface). Any doc that still says “ship `lenderPosition*` as settled frontend work” contradicts 002 + Research — **treat H-4/H-5 as an explicit product decision gate**, not an implied next React task.

### 4. Peer set and “highest affinity”

| Doc | Primary peers | Favorite import |
|------|---------------|-----------------|
| **002** | Uniswap (pinned), Aave, Morpho **SDK**, SE2, Pendle hosted API, Compound Elm | Aave `TxActionsWrapper` + Morpho `{getRequirements, buildTx}` |
| **Research** | OpenPendle, Uniswap, Aave, Morpho **Lite** | **OpenPendle** `ActionPlan` / `txflow` (static + Pendle-ish) |

**Reconcile:** Compatible imports, different exemplars. OpenPendle ≈ Research’s name for the same pattern 002 extracts from Morpho+Aave. Prefer **pattern** (action module + shared machine) over cloning any one repo. Note: Research’s Morpho Lite critique (“TransactionButton too weak”) matches 002’s Morpho SDK preference over thin UI buttons.

### 5. Migration sequencing

| Doc | Order |
|------|-------|
| **001** | Task 4 → 1 (build/CSP) → Task 10 before 3/8 (read ADT) → rest; 5+11 fold together |
| **002** | **Move 0 = land all of 001** → L1 typed reads → L3 action modules → L5 ActionFlow (form-by-form) → L4 engine unify → freeze/forward bounds → process guard |
| **Research** | Baseline *tests* first → typed reads (+ stream pages) → extract ActionDefinitions → upgrade runner (simulate, latch, await refresh) → *then* split modal files → deploy harden → **explicit H-4/H-5 decision** |

**Reconcile:**

```text
Phase A  = 001 Tasks 1–11          (ship defects; pre-shapes L1/L5)
Phase B  = Research step 1 tests   (pin invariants so rewrites don’t reopen WEB-*)
Phase C  = 002 L1 / Research §2    (typed completeness — biggest class)
Phase D  = 002 L3 / Research §3    (extract actions; forms still ugly OK)
Phase E  = 002 L5 then L4          (machine, then unify queue)
           ≈ Research §4           (runner absorbs simulate + queue)
Phase F  = split ActionModal files (after policy extraction — Research §5)
Phase G  = CSP/env/RPC already partly in A; finish SE2 R1–R8
Phase H  = H-4/H-5 gate            (Solidity reopen vs accepted residual)
```

Conflict to resolve in planning: **001 wants CSP/env early (Tasks 1+4); Research puts deploy harden late.** Prefer **001**: CSP/factory fail-loud is cheap and prevents shipping a broken artifact while refactors run.

### 6. Confirm-to-cache / H-3

| Doc | Stance |
|------|--------|
| **002** | Still lists gate/re-arm class under write-policy ownership (historical + drift) |
| **Research** | H-3 re-arm **fixed**; confirm→cache **not** the dominant remaining root cause |

**Reconcile:** Mechanism fixed; **policy ownership** still missing (approve gates, Claim All completeness). Don’t re-open H-3 as unfixed; do keep “single machine owns post-confirm UX” in the target.

### 7. Simulation and chainId pinning

| Doc | Stance |
|------|--------|
| **001** | Not in the ten findings |
| **002** | SE2-class hardening; reject Morpho protocol-mirror simulator; wagmi `simulateContract` enough |
| **Research** | **P2** — mandatory final-call simulation missing; `{ chainId, ...args }` allows caller override (latent) |

**Reconcile:** Put simulation + unoverrideable `chainId` in **Phase E** (runner upgrade), not in Phase A. Aligns with plan 2026-07-28-003 and Research; 002 does not oppose it.

### 8. Target layer naming (same idea, two sketches)

| Concern | 002 | Research |
|---------|-----|----------|
| Action math + requirements | L3 `lib/actions` 5-fn contract | `ActionDefinition` in `lib/actions` |
| UI state machine | L5 `<ActionFlow>` component | Runner state machine; forms stay presentational |
| Write engine | L4 absorbs queue | Same runner executes queue legs |
| Reads | L1 + banned-pattern lint | `ReadResult` wrap existing hooks |
| Query keys | Aave `queryKeysFactory` | Exact invalidation; less insistence on new vocabulary |

**Reconcile:** Adopt 002’s **L3 then L5** split (extract pure modules before replacing the machine — lower risk). Adopt Research’s **runner checklist** (latch, simulate, await critical refresh, Claim All completeness). Treat `queryKeysFactory` as optional follow-on once `action.touched()` exists (002 L4).

### 9. What “local” means

| Doc | Local leftover |
|------|----------------|
| **001** | Task 6 select label; Task 11 parse (also structural-ish) |
| **002** | Most a11y; small W for labeled inputs in L5 |
| **Research** | Only unnamed select is “clearly local” among *current* open classes |

**Reconcile:** Presentation a11y stays OVRFLO’s own tranche; fold labeled inputs into `<ActionFlow>` when it lands so M-1-class doesn’t recur.

---

## Reconciled working position

### What to believe

1. **001 is the near-term backlog.** Implement it; do not wait for L3/L5 to fix the ten verified defects.
2. **002 is the structural diagnosis and migration shape.** “Missing two layers” (typed reads + action/flow ownership) is the right frame; dual write engines and call-site invalidation scope are real.
3. **Research is the best current-state invariant table and peer-affinity check**, and the clearest statement that H-4/H-5 are a *product/Solidity* gate, not a React rewrite justification.
4. **Structural % debates are noise.** Use the shared cluster table above.

### What to build (merged target)

```text
L0  Build/env/CSP          ← 001 Tasks 1+4
L1  Typed read results     ← 001 Tasks 3/8/10 → 002 L1 / Research ReadResult
L2  Discovery completeness ← 001 Task 2 (+ status inseparable from ids)
L3  lib/actions/*          ← 002 Morpho-shaped modules / Research ActionDefinition
L4  One write runner       ← unify queue; simulate; pin chain; await refresh
L5  One flow shell         ← 002 ActionFlow / Aave TxActionsWrapper shape
——  H-4/H-5                ← explicit accept or reopen Solidity (not Phase A–F)
```

### What not to do

- Rewrite Next/wagmi/Reown or adopt SE2/`@scaffold-ui` components.
- Move protocol position discovery onto Ponder.
- Treat stream pagination (001 Task 2) as fixing lending H-4/H-5.
- Split `ActionModal.tsx` into files **before** extracting action policy (Research §5).
- Re-raise disproven Sablier H-1 or rebuild for USD context.

### Suggested reading order for humans/agents

1. This synthesis (orientation).
2. **001** — if implementing this week.
3. **002** §§1, 4, 6, 9 — if planning the multi-week redraw.
4. **Research** §§ invariant table, peer board, migration, known/intentional — if challenging H-4/H-5 or peer choices.

---

## Open conflicts to resolve (outside these three)

These three are internally consistent on “KTD11 declined.” If [`docs/frontend-decision-map.md`](../frontend-decision-map.md) or [`2026-07-28-002` remediation](../plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md) still say per-user indexes are *settled to implement*, that is a **doc conflict with 002 + Research**, not a conflict among the three inputs. Resolve with an explicit product note: either reopen Solidity work or mark H-4/H-5 accepted residual everywhere.

**Needs Verification (unchanged across docs):** whether Vercel honors mid-build `vercel.json` mutation / which header artifact actually ships.

---

## Bottom line

| Question | Reconciled answer |
|----------|-------------------|
| Local bugs or architecture? | **Architecture of ownership** (reads + actions + write engine + build artifacts). Skeleton is sound. |
| Rewrite? | **No.** |
| What ships first? | **001** in full. |
| What kills recurrence? | **Typed reads + action modules + one flow/runner** (002/Research), after 001. |
| What only Solidity can kill? | **Lending H-4/H-5** — decide accept vs reopen; don’t pretend React migration closes it. |
