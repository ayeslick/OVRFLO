# 10 — CS3 stub: borrow request book

**What to build:** After a separate swept CS3 plan exists, a thin router holds borrow requests. The borrower posts stream plus terms with plain `transferFrom`. If acceptable depth exists at post time, the book fills immediately. Later `execute` is permissionless and routes to the cheapest tick at or below the ceiling. Every core `borrow` leg sets `onBehalfOf` to the human and runs only while `lending.router() == address(this)`. `cancel` returns the stream and never consults the router slot. The book holds no `loanId -> borrower` table and no `settle`. Event schema for the two-sided ladder is decided in the CS3 plan.

**This file is a stub.** Do not implement the request book from the denomination plan. KD14 is inheritance for the later plan. Ticket 19 cannot start until this stub is resolved.

**Blocked by:** 08

**Status:** needs-info
**Labels:** needs-info

## Session prompt (paste into a new chat)

```text
STOP. This ticket is a stub. Do not implement the request book from
docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md.

CS3 needs its own plan and sweep after CS1 stabilizes. CS4 must not ship a
placeholder that changes post / execute / wait / cancel semantics or claims a
request exists before CS3.

When a swept CS3 plan exists:
1. Point this ticket's Plan unit at that plan.
2. Replace this session prompt and acceptance criteria from that plan.
3. Set Status: ready-for-agent.
4. Then claim in a new chat.

Until then leave Status: needs-info. Do not write Solidity or request UI.
```

**Required reading:**

- Plan KD10, KD14 CS3 bullets, CS4-U4 no-liquidity gate, CS4-U5 CS3 dependency
- this ticket's acceptance criteria (not executable until the CS3 plan exists)

## Acceptance criteria

- [ ] A swept CS3 plan exists and this ticket points at it
- [ ] Borrower posts stream + `market` / `maxAprBps` (ceiling) / `targetBorrow` / `minAcceptable` via plain `transferFrom` (never `safeTransferFrom`)
- [ ] Escrowed streams are never drawn from
- [ ] `cancel` is borrower-only while the request rests and returns the stream intact without reading the router slot
- [ ] Post-time fill runs when acceptable depth exists; later `execute` is permissionless and fills the cheapest eligible tick
- [ ] Every core `borrow` leg uses `onBehalfOf = human` and requires `lending.router() == address(this)`
- [ ] Proceeds go to the human; the stream returns to the human at close; the book holds nothing after a successful execute except still-resting requests
- [ ] Remaining face is read live at fill time; the book takes no fee
- [ ] No `loanId -> borrower` table and no `settle` exist
- [ ] Safe has called `setLendingRouter` before the book ships

## Plan unit

CS3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md` — placeholder only. Replace with the swept CS3 plan before implementation.
