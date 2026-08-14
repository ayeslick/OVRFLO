# 03 — State-key catalog + standards

**What to build:** Every piece of client state the new app will hold is cataloged with trust domain, writers, and readers. The projection-era catalog is gone. Both standards exist and are citable: the re-extracted UI coding standard and the web engineering standard. An agent can answer blast-radius questions before editing.

**Blocked by:** 02 — Charter + region briefs

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/03-state-key-catalog-and-standards.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not hand-maintain a parallel function catalog as source of truth. Do not write flow UI.
Before any writes, read Required reading below and the plan sections: Goal Capsule, mechanism map, KTD2, KTD8, KTD15, ### U3.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan mechanism map, KTD2, KTD8, KTD15, ### U3
- Eight region briefs from ticket 02
- `docs/maps/state/keys/README.md`, `docs/maps/SCHEMAS.md`
- `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`
- this ticket's acceptance criteria

- [x] State-key catalog is rewritten for the new topology; `projection` shrinks to stream-candidate discovery only, with fail-closed notes
- [x] New namespaces exist for schedule, watch, and USD keys; every key has one trust domain and non-empty writers/readers
- [x] Function/module index is generated from keys (`--check` passes); it is marked generated / not hand-edited as SoT
- [x] `loanPool` appears nowhere under `docs/maps/`
- [x] UI coding standard is re-extracted; every rule cites live brief entries
- [x] Web engineering standard exists; every rule carries a source and MUST/SHOULD force; hard floors are never simplifiable
- [x] `AGENTS.md` lists the web standard as required reading for frontend work
- [x] `lint:maps` is green

## Plan unit

U3 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
