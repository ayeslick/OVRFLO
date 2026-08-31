# 10 — CS3: borrow request book

**What to build:** `OVRFLORequestBook` is a thin router. The borrower posts stream plus terms with plain `transferFrom`. If acceptable depth exists at post time, the book fills immediately. Later `execute` is permissionless and routes to the cheapest tick at or below the ceiling. Every core `borrow` leg sets `onBehalfOf` to the human and runs only while `lending.router() == address(this)`. `cancel` returns the stream and never consults the router slot. Events are `RequestPosted`, `RequestFilled`, and `RequestCancelled` as pinned in KD14.

**Blocked by:** 08

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS3-U1 (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/10-cs3-request-book.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start CS4 request UI (19). Do not add settle
or a loanId-to-borrower table.
Before any writes, write the Solidity intent record (Sequence 6).
Read Required reading below and the plan sections: KD10, KD14 CS3 bullets,
CS3-U1, CS4-U4 no-liquidity gate, Verification Contract successor
*Request book attribution*.
Seed must call setLendingRouter after deploy. DeploySize gates the book.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD10, KD14 CS3 bullets, CS3-U1
- CS4-U4 no-liquidity gate, CS4-U5 CS3 dependency
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch/Solidity intent record exists before the first code write
- [ ] Borrower posts stream + `market` / `maxAprBps` / `targetBorrow` / `minAcceptable` via plain `transferFrom` (never `safeTransferFrom`)
- [ ] Escrowed streams are never drawn from
- [ ] `cancel` is borrower-only while the request rests and returns the stream intact without reading the router slot
- [ ] Post-time fill runs when acceptable depth exists; later `execute` is permissionless and fills the cheapest eligible tick
- [ ] Every core `borrow` leg uses `onBehalfOf = human` and requires `lending.router() == address(this)`
- [ ] Proceeds go to the human; the stream returns to the human at close; the book holds nothing after a successful execute except still-resting requests
- [ ] Remaining face is read live at fill time; the book takes no fee
- [ ] No `loanId -> borrower` table and no `settle` exist
- [ ] Events match KD14 (`RequestPosted`, `RequestFilled`, `RequestCancelled`)
- [ ] Seed calls `setLendingRouter` after deploy; `DeploySize` gates `OVRFLORequestBook`

## Plan unit

CS3-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
