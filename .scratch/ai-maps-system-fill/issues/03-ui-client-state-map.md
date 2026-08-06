# 03 — UI client state map

**What to build:** A living Markets UI/UX state-key catalog (React/machines, query/wagmi/executor, displayed facts) with trust domains (on-chain / projection / pure-client), writers, and readers — plus a **generated** function/module index derived from those keys. An agent can answer blast-radius questions before editing. Does not replace Solidity `x-ray/`.

**Blocked by:** 01 — Maps operating charter

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/03-ui-client-state-map.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not hand-maintain a parallel function catalog as source of truth.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U3, D4, KTD3.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- `docs/maps/state/README.md` and `docs/maps/SCHEMAS.md`
- Markets client surfaces that own state (expand/overlay, query keys, executor/tx-queue, discovery/projection status) — inventory only
- `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md` (trust boundary language)
- Boundary note: `x-ray/entry-points.md` is Solidity-only — do not subsume
- this ticket's acceptance criteria

- [x] State-key catalog documents keys with trust domain, writers, and readers
- [x] Expand/overlay (or current equivalents) and at least one projection/discovery key are covered; projection keys include fail-closed guidance
- [x] Function/module index is generated from keys and marked generated / not hand-edited as SoT
- [x] Generator (or documented generation step) is re-runnable when keys change
- [x] Catalog explicitly does not replace Solidity x-ray
- [x] Sample blast-radius question (“who reads X?”) is answerable from the map

## Plan unit

U3 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
