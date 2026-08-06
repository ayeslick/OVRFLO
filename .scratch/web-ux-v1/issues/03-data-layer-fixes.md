# 03 — Data-layer fixes: invalidation, confirmation state, real symbols

**What to build:** Three real, currently-shipping defects fixed across the app:
1. **Stale data after every transaction.** Right now, confirming a supply/borrow/claim/etc. does not refresh any on-chain data on screen — the invalidation keys used don't match the keys the data-fetching library actually uses, so users have to reload the page to see their own transaction's effect. Fix this app-wide, plus add a short retry schedule for the (indexer-backed) held-streams list specifically, since it can lag a few seconds behind a confirmed transaction.
2. **Wrong "confirmed" moment.** Forms that require an approval step before the real action currently show "confirmed" as soon as the *approval* transaction lands, not the actual action — meaning a user could see a false completion state after only approving, before their supply/borrow/etc. has happened. Split every such form's tracked transaction state so "confirmed" and any close/done affordance only reflect the real action's receipt.
3. **Fake token symbols.** Several places in the UI hardcode the token symbols ("wstETH", "ovrflo") instead of reading them from the actual deployed market — meaning a second market with different underlying tokens would show the wrong symbol everywhere. Read real symbols per market and thread them through.

Also in scope: the read needed to know when a loan can actually be closed (so the app doesn't offer a CLOSE button that's guaranteed to revert), the "list may be truncated" signal exposed by the app's position-enumeration hooks, and resetting form state cleanly when the connected wallet changes mid-session.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Automated regression test: confirming any write refetches all on-chain reads and the held-streams list, verified via a spy on the invalidation call rather than manual reload
- [x] Automated regression test: an approval-only receipt never shows the action-complete state; only the real action's receipt does
- [x] A second market with different token symbols renders its own real symbols everywhere — no hardcoded literal remains
- [x] A loan whose backing stream doesn't have enough withdrawable balance yet does not show a CLOSE button; one that does, does
- [x] Every form that shows this state resets (selected stream, entered amount, approval progress) when the connected address changes, with a clear "wallet changed, re-enter" message rather than silently acting on stale selections
- [x] Full existing test suite still green (this touches nearly every form — treat as the highest-risk unit in this plan; see Unit U3 in `docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md`)

## Comments

**2026-07-27 (agent):** Resolved in commit 629d6ff. KTD5: `useWriteFlow(user?)` + shared `invalidateAllOnChainReads` (wagmi 3.7.3 key roots verified in node_modules) + capped 2s/5s held-streams retry with early-stop; `query-keys.ts` pruned to `streamKeys`; cosmetic `queryKey` fields deleted from all hooks. KTD6: approve/action split in SupplyForm, ConvertForm, BorrowForm, RepayForm, and SellForm (in scope via the ticket's "forms that require an approval step" wording; SellForm dies in U8 anyway); `ApproveTxState` never renders CONFIRMED. KTD7: `useMarketSymbols` + `symbolFor`, threaded MarketsApp → table/detail/positions/forms; zero symbol literals remain. Close gate via separate Sablier `withdrawableAmountOf` batches in both loan hooks (lending batch strides untouched); lender `claimable` now projected via `recoveredForClaimable`. R26 truncation warnings in PositionList; R30 wallet-change reset in every form. 14 new tests; suite 71/71, eslint + banned-patterns clean. Both review axes (haiku standards + spec) passed; one dead ternary branch simplified per review.
