# 09 — Borrow flow

**What to build:** Borrow from stream select through confirmed receipt in the spacious composition: depth-aware rate window, draw-vs-pool band, cover date, gold you-receive, sale-equivalence copy when drawing the stream's full remaining value.

**Blocked by:** 04 — Component kit; 06 — Hooks + executor re-anchor

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U9 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/09-borrow-flow.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not implement Supply or Assets. Follow the borrow brief and flow-spec Borrow table.
Before any writes, read Required reading below and the plan sections: Goal Capsule, R6, R13–R14, AE6, KTD5, KTD10, ### U9.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R6, R13–R14, AE6, ### U9
- Borrow and review briefs from ticket 02
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` Borrow table + exceptions (read-only)
- `PRODUCT.md` (maximum borrow is economically a sale)
- `docs/agents/testing.md` before E2E
- this ticket's acceptance criteria

- [x] Full borrow reaches CONFIRMED with loan identity, net, obligation, and cover date in the receipt
- [x] Stream context has CHANGE; amount vs stream-derived cap (balance-independent MAX)
- [x] Depth-aware rate window plus draw-vs-pool band flags partial fills before review
- [x] Review freezes the quote; `minAcceptable` derives from reviewed net; quote drift freezes signing with visible diff
- [x] NFT approval receipt names asset/operator/scope; fee-from-proceeds stated (no fee approval exists)
- [x] Full-remaining draw states sale equivalence plainly
- [x] Partial fill re-presents actuals before signing; empty tick returns to rate selection naming live ticks
- [x] No eligible stream renders the guided handoff, never a disabled form
- [x] `BelowMinimum` copy distinguishes fill-floor vs stream-face
- [x] Repay-preview context shows current and post-repay cover dates (AE6)
- [ ] Confirmed borrow appears on the borrowed lens with ribbon and countdown — U9 navigates to `/?lens=borrowed&loan=`; watch row is U7
- [ ] Component tests green; E2E borrow on fork confirms loan + cover date — component tests green (`tests/borrow`); E2E is out of this unit

## Plan unit

U9 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
