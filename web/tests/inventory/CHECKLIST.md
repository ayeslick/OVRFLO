# Render inventory checklist (U14)

Fixture-driven harness under `web/tests/inventory/`. Each item mounts shipped
kit / watch / supply / borrow / assets / first-run components with pinned
fixtures and asserts the owning brief's labels, states, and action-visibility.

Transacting topologies run at **1280px and 360px**.

Authority: `docs/plans/2026-08-11-markets-frontend-flow-spec.md` (the 24) plus
plan ### U14 additions. Briefs: `docs/maps/ui/*.md`.

## Flow-spec 24

| # | Item | Test | Brief |
|---|---|---|---|
| 1 | 1. ENTRY.DISCONNECTED | `watch-surface.test.tsx` | `shell.md` `UI-SHELL-ENTRY-DISCONNECTED` |
| 2 | 2. ENTRY.READY | `watch-surface.test.tsx` | `watch.md` entry / `UI-WATCH-WALL` |
| 3 | 3. BORROW.SELECT_STREAM | `borrow.test.tsx` | `borrow.md` `UI-BORROW-SELECT-STREAM` |
| 4 | 4. BORROW.ENTER_AMOUNT + SELECT_RATE | `borrow.test.tsx` | `borrow.md` amount + rate |
| 5 | 5. BORROW.REVIEW | `borrow.test.tsx` | `review.md` `UI-REVIEW-BORROW` |
| 6 | 6. BORROW.APPROVE_STREAM | `borrow.test.tsx` | `review.md` `UI-REVIEW-APPROVE` |
| 7 | 7. BORROW.SIGN | `borrow.test.tsx` | `review.md` `UI-REVIEW-CONFIRM` |
| 8 | 8. BORROW.CONFIRMED | `borrow.test.tsx` | `review.md` `UI-REVIEW-ACTION-RECEIPT` |
| 9 | 9. SUPPLY.SELECT_MARKET | `supply.test.tsx` | `supply.md` `UI-SUPPLY-SELECT-MARKET` |
| 10 | 10. SUPPLY.ENTER_AMOUNT + SELECT_RATE | `supply.test.tsx` | `supply.md` amount + rate |
| 11 | 11. SUPPLY.REVIEW | `supply.test.tsx` | `review.md` `UI-REVIEW-SUPPLY` |
| 12 | 12. SUPPLY.APPROVE | `supply.test.tsx` | `review.md` `UI-REVIEW-APPROVE` |
| 13 | 13. SUPPLY.SIGN | `supply.test.tsx` | `review.md` `UI-REVIEW-CONFIRM` |
| 14 | 14. SUPPLY.CONFIRMED | `supply.test.tsx` | `review.md` confirmed receipt |
| 15 | 15. POSITIONS.INDEX + SUPPLY_DETAIL | `watch-surface.test.tsx` | `watch.md` `UI-WATCH-DETAIL-SUPPLIED` |
| 16 | 16. POSITIONS.INDEX + LOAN_DETAIL | `watch-surface.test.tsx` | `watch.md` `UI-WATCH-DETAIL-BORROWED` |
| 17 | 17. POSITIONS.INDEX + STREAM_DETAIL | `watch-surface.test.tsx` | `watch.md` `UI-WATCH-DETAIL-STREAM` |
| 18 | 18. LOADING / EMPTY / STALE / PENDING / ERROR per topology | `states.test.tsx` | flow-spec global states |
| 19 | 19. POSITIONS.CLAIM_CONFIRMED unwrap-enabled | `writes.test.tsx` | `review.md` `UI-REVIEW-CLAIM-CONFIRMED` |
| 20 | 20. POSITIONS.CLAIM_CONFIRMED reserve-insufficient | `writes.test.tsx` | `review.md` `UI-REVIEW-CLAIM-CONFIRMED` |
| 21 | 21. POSITIONS.UNWRAP_REVIEW + UNWRAP_CONFIRMED | `writes.test.tsx` | `review.md` `UI-REVIEW-UNWRAP` |
| 22 | 22. STREAM.REVIEW + APPROVE_PT + APPROVE_FEE | `writes.test.tsx` | `review.md` `UI-REVIEW-STREAM-DEPOSIT` |
| 23 | 23. ASSETS.WRAP_AMOUNT + WRAP_APPROVE + WRAP_CONFIRMED | `writes.test.tsx` | `assets.md` / `UI-REVIEW-WRAP` |
| 24 | 24. POSITIONS.REPAY_AMOUNT + REPAY_PREPARE + REPAY_APPROVE + REPAY_CONFIRMED | `writes.test.tsx` | `review.md` `UI-REVIEW-REPAY` |

## Plan additions

| # | Item | Test |
|---|---|---|
| A | A. three lens renders (SUPPLIED / BORROWED / STREAMS) | `watch-surface.test.tsx` |
| B | B. ribbon state set (recorded / edge / future / inert / degraded) | `ribbon.test.tsx` |
| C | C. degraded status (UI-SHELL-STATUS) | `ribbon.test.tsx`, `watch-surface.test.tsx` |
| D | D. first-run | `first-run-risk.test.tsx`, `watch-surface.test.tsx` |
| E | E. risk | `first-run-risk.test.tsx` |
| F | F. acknowledgment step | `first-run-risk.test.tsx`, `writes.test.tsx` |
| G | G. both claim-confirmed variants | `writes.test.tsx` |
| H | H. narrow-viewport watch navigation | `watch-surface.test.tsx` |

## Revert freshness

Successor to deleted `web/tests-live/reorg-freshness.test.ts`: `revert-freshness.test.tsx`.
Mocked revert+refetch — not live Anvil `evm_revert`.
