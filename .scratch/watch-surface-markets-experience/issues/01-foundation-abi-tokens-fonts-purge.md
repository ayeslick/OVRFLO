# 01 — Foundation: ABI, tokens, fonts, purge

**What to build:** The app builds against the v1-lite ABI with the gold one-bit tokens and self-hosted faces. Every module that exists only for the old contract is gone. The interim app may be visually empty but must compile, with maps presence still honest via temporary purge exemptions.

**Blocked by:** None — can start immediately.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/01-foundation-abi-tokens-fonts-purge.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not start other units. Do not write flow UI or new kit components.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Product Contract Key Decisions, Design System Pins, Verification Contract, Definition of Done, ### U1.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Goal Capsule stop conditions, Design System Pins, Verification Contract grep/supply-chain gates, ### U1
- `PRODUCT.md` (product truth boundary)
- https://ethskills.com/SKILL.md (frontend-playbook / fonts and static-export notes as relevant)
- this ticket's acceptance criteria

- [x] App builds clean with unused-locals checking enabled
- [x] ABI is regenerated from the current v1-lite contracts
- [x] Gold one-bit tokens replace retired palettes; cyan / Inter / NOW-NEXT / old-book identifiers are gone from web source and tests (purge grep gates)
- [x] Faces load from one local font definitions file; licenses ship beside the files
- [x] Direction-contract comment is present in static-export output (`THESIS:`)
- [x] Deleted old-ABI / old-topology modules have maps-presence exemption entries (reason: purged in U1) so `lint:maps` stays green
- [x] Every deleted test file has a test-accountability ledger entry
- [x] Static-export output has no external script/style origins

## Plan unit

U1 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
